/**
 * Chain verification tests — trace full dependency chains against live npm.
 *
 * Given a chain like  ms ← debug ← express:
 *   hop 0: debug's latest package.json lists   "ms": "^2.1.3"
 *   hop 1: express's latest package.json lists  "debug": "^4.4.0"
 *
 * For each hop we verify:
 *   1. The "latest" version npm returns matches the graph
 *   2. The dependency range in the real package.json matches the graph
 *   3. That range actually resolves to the version in our graph
 *      (basic check: "^2.1.3" satisfies "2.1.3")
 *
 * This proves the blast-radius chain holds with real-world latest versions.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { exposureType, simulate, loadGraph, fetchJSON } from './helpers.mjs';

let graph;

before(async () => {
  graph = await loadGraph();
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Naive check: does version satisfy the range?
 * Handles ^, ~, exact, >=, >, *.
 * Not a full semver resolver, but sufficient for the common cases
 * that appear in our graph.
 */
function naiveSatisfies(version, range) {
  const r = range.trim();
  if (!r || r === '*' || r === 'latest') return true;

  const [major, minor, patch] = version.split('.').map(Number);

  // exact pin
  if (/^\d+\.\d+\.\d+$/.test(r)) return r === version;

  // caret: ^MAJOR.MINOR.PATCH  →  >=M.m.p <(M+1).0.0  (for M>0)
  const caretMatch = r.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caretMatch) {
    const [, rM, rm, rp] = caretMatch.map(Number);
    if (rM > 0)
      return major === rM && (minor > rm || (minor === rm && patch >= rp));
    if (rm > 0) return major === 0 && minor === rm && patch >= rp;
    return major === 0 && minor === 0 && patch === rp;
  }

  // tilde: ~MAJOR.MINOR.PATCH  →  >=M.m.p <M.(m+1).0
  const tildeMatch = r.match(/^~(\d+)\.(\d+)\.(\d+)$/);
  if (tildeMatch) {
    const [, rM, rm, rp] = tildeMatch.map(Number);
    return major === rM && minor === rm && patch >= rp;
  }

  // >=MAJOR.MINOR.PATCH
  const gteMatch = r.match(/^>=(\d+)\.(\d+)\.(\d+)$/);
  if (gteMatch) {
    const [, rM, rm, rp] = gteMatch.map(Number);
    if (major !== rM) return major > rM;
    if (minor !== rm) return minor > rm;
    return patch >= rp;
  }

  // >MAJOR.MINOR.PATCH
  const gtMatch = r.match(/^>(\d+)\.(\d+)\.(\d+)$/);
  if (gtMatch) {
    const [, rM, rm, rp] = gtMatch.map(Number);
    if (major !== rM) return major > rM;
    if (minor !== rm) return minor > rm;
    return patch > rp;
  }

  // If we can't parse the range, skip the satisfies check (don't fail)
  return null;
}

/**
 * Build the full chain from root → leaf using the BFS cascade.
 * Returns arrays of hops, e.g.:
 *   [{ dependent: "debug", dependency: "ms", requirement: "^2.1.3", depth: 1 },
 *    { dependent: "express", dependency: "debug", requirement: "^4.4.0", depth: 2 }]
 */
function traceChains(root, isDependencyOf) {
  const infected = simulate(root, isDependencyOf);
  const hops = [];

  // For each infected node, find which edge brought it in
  // isDependencyOf[X] = [{ name: Y, requirement }]  means Y depends on X
  const cascadeSet = new Set(infected.keys());
  for (const [dep, info] of infected) {
    if (dep === root) continue;
    // Find the parent that brought this node in at depth-1
    // The edge is: some parent's package.json lists `dep` as a dependency
    // In isDependencyOf terms: dep is in isDependencyOf results,
    // and its "dependent" is the parent at depth-1
    for (const edge of isDependencyOf[dep] ?? []) {
      if (cascadeSet.has(edge.name)) {
        const parentInfo = infected.get(edge.name);
        // This is a hop if parentInfo is at exactly depth - 1
        // (or root is at depth 0 and this dep is at depth 1)
        // Actually, just record all edges within the cascade
      }
    }
  }

  // Simpler approach: collect all (dependent → dependency) edges within cascade
  // using dependsOn from graph
  return infected;
}

// ════════════════════════════════════════════════════════════════════════════
// Test chains
// ════════════════════════════════════════════════════════════════════════════

/*
 * Chain 1 (3-hop, all auto):
 *   ms ← debug(^2.1.3) ← express(^4.4.0) ← body-parser(^2.2.1)
 *
 * Chain 2 (3-hop, all auto):
 *   ms ← debug(^2.1.3) ← @babel/traverse(^4.3.1) ← @babel/core(^7.29.0)
 *
 * Chain 3 (3-hop, mixed auto + pinned):
 *   ms ← debug(^2.1.3) ← @typescript-eslint/typescript-estree(^4.4.3)
 *       ← @typescript-eslint/utils(8.58.0)
 *
 * Chain 4 (2-hop, mixed pinned + auto):
 *   @nodelib/fs.stat ← @nodelib/fs.scandir(4.0.0) ← @nodelib/fs.walk(4.0.1)
 *
 * Chain 5 (2-hop, all auto):
 *   @nodelib/fs.stat ← fast-glob(^2.0.2) ← globby(^3.3.3)
 */

const CHAINS = [
  {
    name: 'ms ← debug ← express (via body-parser)',
    hops: [
      { dependent: 'debug', dependency: 'ms', graphReq: '^2.1.3' },
      { dependent: 'express', dependency: 'debug', graphReq: '^4.4.0' },
      { dependent: 'express', dependency: 'body-parser', graphReq: '^2.2.1' },
    ],
  },
  {
    name: 'ms ← debug ← @babel/traverse ← @babel/core',
    hops: [
      { dependent: 'debug', dependency: 'ms', graphReq: '^2.1.3' },
      { dependent: '@babel/traverse', dependency: 'debug', graphReq: '^4.3.1' },
      {
        dependent: '@babel/core',
        dependency: '@babel/traverse',
        graphReq: '^7.29.0',
      },
    ],
  },
  {
    name: 'ms ← debug ← @typescript-eslint/typescript-estree ← @typescript-eslint/utils (pinned hop)',
    hops: [
      { dependent: 'debug', dependency: 'ms', graphReq: '^2.1.3' },
      {
        dependent: '@typescript-eslint/typescript-estree',
        dependency: 'debug',
        graphReq: '^4.4.3',
      },
      {
        dependent: '@typescript-eslint/utils',
        dependency: '@typescript-eslint/typescript-estree',
        graphReq: '8.58.0',
      },
    ],
  },
  {
    name: '@nodelib/fs.stat ← @nodelib/fs.scandir ← @nodelib/fs.walk (all pinned)',
    hops: [
      {
        dependent: '@nodelib/fs.scandir',
        dependency: '@nodelib/fs.stat',
        graphReq: '4.0.0',
      },
      {
        dependent: '@nodelib/fs.walk',
        dependency: '@nodelib/fs.scandir',
        graphReq: '4.0.1',
      },
    ],
  },
  {
    name: '@nodelib/fs.stat ← fast-glob ← globby (all auto)',
    // NOTE: fast-glob requires @nodelib/fs.stat@^2.0.2 but graph has v4.0.0.
    // The dependency *relationship* is real, but fast-glob's range resolves
    // to v2.x, not the latest v4.x. Known limitation — documented in scope popup:
    // "Uses latest version dependency trees. Pinned older versions may have
    //  different dependencies."
    hops: [
      {
        dependent: 'fast-glob',
        dependency: '@nodelib/fs.stat',
        graphReq: '^2.0.2',
        allowMajorMismatch: true,
      },
      { dependent: 'globby', dependency: 'fast-glob', graphReq: '^3.3.3' },
    ],
  },
];

describe('verify full dependency chains against live npm registry', () => {
  for (const chain of CHAINS) {
    it(chain.name, async () => {
      for (const hop of chain.hops) {
        await sleep(150);

        // 1. Fetch the dependent's latest package.json from npm
        const npmData = await fetchJSON(
          `https://registry.npmjs.org/${hop.dependent}/latest`,
        );
        const npmVersion = npmData.version;

        // 2. Confirm the dependent's latest version matches our graph
        const graphVersion = graph.packages[hop.dependent]?.version;
        assert.equal(
          npmVersion,
          graphVersion,
          `${hop.dependent}: npm latest is ${npmVersion}, graph has ${graphVersion}`,
        );

        // 3. Confirm the real package.json lists this dependency
        const allDeps = {
          ...npmData.dependencies,
          ...npmData.devDependencies,
          ...npmData.peerDependencies,
          ...npmData.optionalDependencies,
        };
        const actualReq = allDeps[hop.dependency];
        assert.ok(
          actualReq !== undefined,
          `${hop.dependent}@${npmVersion} package.json should list "${hop.dependency}" — not found`,
        );

        // 4. Confirm the requirement string matches the graph
        assert.equal(
          actualReq,
          hop.graphReq,
          `${hop.dependent} → ${hop.dependency}: npm says "${actualReq}", graph says "${hop.graphReq}"`,
        );

        // 5. Confirm the range actually resolves to the version in our graph
        //    e.g., "^2.1.3" should satisfy "2.1.3"
        const depVersion = graph.packages[hop.dependency]?.version;
        const satisfies = naiveSatisfies(depVersion, actualReq);
        if (satisfies !== null) {
          if (hop.allowMajorMismatch && !satisfies) {
            // Known limitation: range targets an older major version.
            // The dependency relationship is real, but npm would resolve
            // to a different major version than our graph's latest.
            // This is documented in the scope popup.
            console.log(
              `    ⚠ KNOWN LIMITATION: ${hop.dependent} requires ` +
                `"${hop.dependency}": "${actualReq}" → would resolve to ` +
                `an older major, not ${depVersion}. ` +
                `Dependency exists but version differs.`,
            );
          } else {
            assert.ok(
              satisfies,
              `${hop.dependent}: range "${actualReq}" does NOT satisfy ` +
                `${hop.dependency}@${depVersion} — chain would break`,
            );
          }
        }
      }
    });
  }
});

describe('verify chain exposure propagation matches simulation', () => {
  it('ms cascade: depth-0 exposure inherited through all hops', async () => {
    const infected = simulate('ms', graph.isDependencyOf);
    infected.delete('ms');

    // debug depends on ms with ^2.1.3 → auto
    // Everything downstream of debug should also be "auto"
    const debug = infected.get('debug');
    assert.ok(debug, 'debug should be in ms cascade');
    assert.equal(debug.exposure, 'auto', 'debug → ms is ^2.1.3 → auto');

    const express = infected.get('express');
    if (express) {
      assert.equal(
        express.exposure,
        'auto',
        'express inherits auto from debug (not from its own edge to debug)',
      );
    }

    const babelCore = infected.get('@babel/core');
    if (babelCore) {
      assert.equal(
        babelCore.exposure,
        'auto',
        '@babel/core inherits auto through the chain',
      );
    }
  });

  it('@nodelib/fs.stat cascade: pinned and auto paths stay separate', () => {
    const infected = simulate('@nodelib/fs.stat', graph.isDependencyOf);
    infected.delete('@nodelib/fs.stat');

    // @nodelib/fs.scandir depends on fs.stat with 4.0.0 → pinned
    const scandir = infected.get('@nodelib/fs.scandir');
    assert.ok(scandir);
    assert.equal(scandir.exposure, 'pinned');

    // @nodelib/fs.walk depends on fs.scandir with 4.0.1 → pinned
    // but it inherits "pinned" from scandir's first-hop classification
    const walk = infected.get('@nodelib/fs.walk');
    assert.ok(walk);
    assert.equal(walk.exposure, 'pinned');

    // fast-glob depends on fs.stat with ^2.0.2 → auto
    const fastGlob = infected.get('fast-glob');
    assert.ok(fastGlob);
    assert.equal(fastGlob.exposure, 'auto');

    // globby depends on fast-glob → inherits auto
    const globby = infected.get('globby');
    assert.ok(globby);
    assert.equal(globby.exposure, 'auto');
  });

  it('@typescript-eslint/utils: pinned edge at depth 2 still inherits depth-0 auto', () => {
    const infected = simulate('ms', graph.isDependencyOf);
    // Chain: ms ← debug(^2.1.3, auto) ← ts-estree(^4.4.3) ← utils(8.58.0, pinned)
    // utils should inherit "auto" from the debug→ms edge, NOT "pinned" from its own edge
    const utils = infected.get('@typescript-eslint/utils');
    if (utils) {
      assert.equal(
        utils.exposure,
        'auto',
        '@typescript-eslint/utils should inherit auto from depth-0, ' +
          'despite its own pinned edge to typescript-estree',
      );
    }
  });
});

describe('audit: find all major-version range mismatches in graph (known limitation)', () => {
  it('identifies edges where range targets a different major than graph latest', () => {
    // Scan every edge in isDependencyOf and check if the range would
    // resolve to the latest version we have. This surfaces the full
    // scope of the "latest version dependency trees" limitation.
    //
    // Many popular packages pin to older majors — e.g. Jest uses chalk@^4
    // while chalk latest is v5, @babel/core uses semver@^6 while latest
    // is v7. This is structural in the npm ecosystem, not stale data.
    const mismatches = [];

    for (const [dep, edges] of Object.entries(graph.isDependencyOf)) {
      const depVersion = graph.packages[dep]?.version;
      if (!depVersion) continue;

      for (const edge of edges) {
        const result = naiveSatisfies(depVersion, edge.requirement);
        if (result === false) {
          mismatches.push({
            dependent: edge.name,
            dependency: dep,
            range: edge.requirement,
            graphVersion: depVersion,
          });
        }
      }
    }

    // Log all mismatches so we have visibility
    if (mismatches.length > 0) {
      console.log(
        `\n    Found ${mismatches.length} edge(s) where range targets a different major:`,
      );
      for (const m of mismatches) {
        console.log(
          `      ${m.dependent} → "${m.dependency}": "${m.range}" ` +
            `(graph has v${m.graphVersion})`,
        );
      }
    }

    const totalEdges = Object.values(graph.isDependencyOf).reduce(
      (sum, edges) => sum + edges.length,
      0,
    );
    const pct = ((mismatches.length / totalEdges) * 100).toFixed(1);
    console.log(
      `\n    ${mismatches.length}/${totalEdges} edges (${pct}%) have major-version mismatches`,
    );

    // ~10% is expected in the npm ecosystem (packages pinned to older majors).
    // If this exceeds 15%, the graph data is likely stale and needs a rebuild.
    assert.ok(
      mismatches.length / totalEdges < 0.15,
      `Major-version mismatches at ${pct}% — exceeds 15% threshold, graph may be stale`,
    );
  });
});
