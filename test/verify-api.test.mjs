/**
 * Integration tests — verify graph.json claims against live APIs.
 *
 * These tests hit:
 *   • deps.dev   (version + dependent counts)
 *   • npm registry (actual package.json dependency ranges)
 *
 * They confirm that our stored graph data matches what the real
 * package registries report for the latest version.
 *
 * NOTE: These require network access and may be slow (~5-10s).
 *       Dependent counts may drift as new packages are published;
 *       we allow a tolerance for that.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { exposureType, simulate, loadGraph, fetchJSON } from './helpers.mjs';

let graph;

before(async () => {
  graph = await loadGraph();
});

// ── Packages to verify ──────────────────────────────────────────────────
// Chosen for coverage:
//   @types/estree    — shallow (depth 1), mixed auto + pinned
//   @nodelib/fs.stat — medium  (depth 2), mixed auto + pinned
//   ms               — deep    (depth 3), all auto, high-impact
const TEST_PACKAGES = ['@types/estree', '@nodelib/fs.stat', 'ms'];

// Helper: small delay to avoid rate-limiting
const sleep = ms => new Promise(r => setTimeout(r, ms));

describe('verify graph version against deps.dev', () => {
  for (const pkg of TEST_PACKAGES) {
    it(`${pkg} — graph version matches deps.dev latest`, async () => {
      const encoded = encodeURIComponent(pkg);
      const data = await fetchJSON(
        `https://api.deps.dev/v3/systems/npm/packages/${encoded}`,
      );
      const defaultVer = data.versions.find(v => v.isDefault);
      assert.ok(
        defaultVer,
        `deps.dev should have a default version for ${pkg}`,
      );
      assert.equal(
        graph.packages[pkg].version,
        defaultVer.versionKey.version,
        `graph version should match deps.dev latest`,
      );
      await sleep(200);
    });
  }
});

describe('verify dependent counts against deps.dev', () => {
  for (const pkg of TEST_PACKAGES) {
    it(`${pkg} — dependent counts match (or within tolerance)`, async () => {
      const info = graph.packages[pkg];
      const encoded = encodeURIComponent(pkg);
      const data = await fetchJSON(
        `https://api.deps.dev/v3alpha/systems/npm/packages/${encoded}/versions/${info.version}:dependents`,
      );

      // Allow 5% drift since counts update continuously
      const tolerance = 0.05;

      const totalDiff = Math.abs(data.dependentCount - info.totalDependents);
      const totalPct =
        info.totalDependents > 0 ? totalDiff / info.totalDependents : 0;
      assert.ok(
        totalPct <= tolerance,
        `${pkg} total dependents: graph=${info.totalDependents}, ` +
          `api=${data.dependentCount} (${(totalPct * 100).toFixed(1)}% drift)`,
      );

      const directDiff = Math.abs(
        data.directDependentCount - info.directDependents,
      );
      const directPct =
        info.directDependents > 0 ? directDiff / info.directDependents : 0;
      assert.ok(
        directPct <= tolerance,
        `${pkg} direct dependents: graph=${info.directDependents}, ` +
          `api=${data.directDependentCount} (${(directPct * 100).toFixed(1)}% drift)`,
      );
      await sleep(200);
    });
  }
});

describe('verify dependency edges against npm registry', () => {
  for (const pkg of TEST_PACKAGES) {
    it(`${pkg} — every depth-0 edge matches actual package.json`, async () => {
      const edges = graph.isDependencyOf[pkg] ?? [];
      assert.ok(edges.length > 0, `${pkg} should have at least one dependent`);

      for (const edge of edges) {
        await sleep(150);

        const npmData = await fetchJSON(
          `https://registry.npmjs.org/${edge.name}/latest`,
        );

        // Merge all dep types
        const allDeps = {
          ...npmData.dependencies,
          ...npmData.devDependencies,
          ...npmData.peerDependencies,
          ...npmData.optionalDependencies,
        };

        const actualReq = allDeps[pkg];
        assert.ok(
          actualReq !== undefined,
          `${edge.name} should list ${pkg} in its dependencies (npm registry)`,
        );
        assert.equal(
          actualReq,
          edge.requirement,
          `${edge.name} → ${pkg}: npm says "${actualReq}", graph says "${edge.requirement}"`,
        );
      }
    });
  }
});

describe('verify cascade edges against npm registry (multi-hop)', () => {
  it('ms — full 3-hop cascade edges match npm', async () => {
    const pkg = 'ms';
    const infected = simulate(pkg, graph.isDependencyOf);
    infected.delete(pkg);

    // Collect all edges within the cascade
    const cascadeSet = new Set([pkg, ...infected.keys()]);
    const edgesToCheck = [];
    const seen = new Set();

    for (const parent of cascadeSet) {
      for (const depEdge of graph.dependsOn[parent] ?? []) {
        if (cascadeSet.has(depEdge.name)) {
          const key = `${parent}→${depEdge.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            edgesToCheck.push({
              parent,
              dep: depEdge.name,
              graphReq: depEdge.requirement,
            });
          }
        }
      }
    }
    // Also include isDependencyOf edges for root
    for (const edge of graph.isDependencyOf[pkg] ?? []) {
      if (cascadeSet.has(edge.name)) {
        const key = `${edge.name}→${pkg}`;
        if (!seen.has(key)) {
          seen.add(key);
          edgesToCheck.push({
            parent: edge.name,
            dep: pkg,
            graphReq: edge.requirement,
          });
        }
      }
    }

    assert.ok(
      edgesToCheck.length >= 5,
      `expected at least 5 edges in ms cascade, got ${edgesToCheck.length}`,
    );

    let mismatches = 0;
    for (const { parent, dep, graphReq } of edgesToCheck) {
      await sleep(120);
      const npmData = await fetchJSON(
        `https://registry.npmjs.org/${parent}/latest`,
      );
      const allDeps = {
        ...npmData.dependencies,
        ...npmData.devDependencies,
        ...npmData.peerDependencies,
        ...npmData.optionalDependencies,
      };
      const actualReq = allDeps[dep];
      if (actualReq === undefined) {
        mismatches++;
        continue;
      }
      // Even if the string differs slightly, exposure type must match
      if (actualReq !== graphReq) {
        const graphExp = exposureType(graphReq);
        const actualExp = exposureType(actualReq);
        assert.equal(
          actualExp,
          graphExp,
          `${parent} → ${dep}: exposure mismatch (npm="${actualReq}"→${actualExp}, graph="${graphReq}"→${graphExp})`,
        );
      }
    }

    assert.ok(
      mismatches === 0,
      `${mismatches} edges not found in npm registry`,
    );
  });
});

describe('verify exposure classification matches live data', () => {
  it('@nodelib/fs.stat — pinned vs auto classification correct', async () => {
    // This is the only package with mixed types in our dataset
    const pkg = '@nodelib/fs.stat';
    const infected = simulate(pkg, graph.isDependencyOf);
    infected.delete(pkg);

    for (const edge of graph.isDependencyOf[pkg] ?? []) {
      if (!infected.has(edge.name)) continue;
      await sleep(150);

      const npmData = await fetchJSON(
        `https://registry.npmjs.org/${edge.name}/latest`,
      );
      const allDeps = {
        ...npmData.dependencies,
        ...npmData.devDependencies,
        ...npmData.peerDependencies,
        ...npmData.optionalDependencies,
      };
      const actualReq = allDeps[pkg];
      assert.ok(actualReq, `${edge.name} should depend on ${pkg}`);

      const graphClassification = exposureType(edge.requirement);
      const actualClassification = exposureType(actualReq);
      assert.equal(
        actualClassification,
        graphClassification,
        `${edge.name}: classified as ${graphClassification} in graph ` +
          `but npm says "${actualReq}" → ${actualClassification}`,
      );
    }
  });
});
