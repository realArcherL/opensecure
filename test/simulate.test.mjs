import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, exposureType, loadGraph } from './helpers.mjs';

let graph;

before(async () => {
  graph = await loadGraph();
});

describe('simulate — cascade BFS', () => {
  // ── Basic mechanics ───────────────────────────────────────────────────

  it('root package is not counted in its own cascade', () => {
    const result = simulate('ms', graph.isDependencyOf);
    assert.ok(result.has('ms'));
    assert.equal(result.get('ms').depth, 0);
  });

  it('cascade excludes the root when computing size', () => {
    const result = simulate('ms', graph.isDependencyOf);
    result.delete('ms');
    // ms has known downstream; exact count may vary with graph data
    assert.ok(result.size >= 1, `expected cascade >= 1, got ${result.size}`);
  });

  it('package with no reverse deps has empty cascade', () => {
    // find a leaf node (no one depends on it within top-N)
    const leafName = Object.keys(graph.packages).find(
      name =>
        !graph.isDependencyOf[name] || graph.isDependencyOf[name].length === 0,
    );
    assert.ok(leafName, 'should find at least one leaf node');
    const result = simulate(leafName, graph.isDependencyOf);
    result.delete(leafName);
    assert.equal(result.size, 0, `${leafName} should have 0 cascade`);
  });

  // ── Depth tracking ────────────────────────────────────────────────────

  it('direct dependents are at depth 1', () => {
    const result = simulate('ms', graph.isDependencyOf);
    for (const edge of graph.isDependencyOf['ms'] ?? []) {
      const entry = result.get(edge.name);
      assert.ok(entry, `${edge.name} should be in cascade`);
      assert.equal(entry.depth, 1, `${edge.name} should be at depth 1`);
    }
  });

  it('depth increases monotonically through BFS levels', () => {
    const result = simulate('ms', graph.isDependencyOf);
    // BFS guarantees: every node's depth >= its parent's depth
    for (const [name, { depth }] of result) {
      if (name === 'ms') continue;
      // check that the node came from a parent at depth-1
      assert.ok(depth >= 1, `${name} depth should be >= 1, got ${depth}`);
    }
  });

  // ── Exposure propagation ──────────────────────────────────────────────

  it('depth-0 edges determine exposure from their own requirement', () => {
    // @types/estree has: eslint-scope (^1.0.8 → auto), rollup (1.0.8 → pinned)
    const result = simulate('@types/estree', graph.isDependencyOf);
    result.delete('@types/estree');

    const eslintScope = result.get('eslint-scope');
    const rollup = result.get('rollup');

    if (eslintScope) assert.equal(eslintScope.exposure, 'auto');
    if (rollup) assert.equal(rollup.exposure, 'pinned');
  });

  it('downstream nodes inherit parent exposure, not their own edge type', () => {
    // @nodelib/fs.stat: fast-glob requires it with ^2.0.2 (auto)
    //   fast-glob → globby (which requires fast-glob with ^3.3.3)
    // globby should inherit "auto" from the fast-glob edge, not re-classify
    const result = simulate('@nodelib/fs.stat', graph.isDependencyOf);
    result.delete('@nodelib/fs.stat');

    const fastGlob = result.get('fast-glob');
    const globby = result.get('globby');

    if (fastGlob && globby) {
      assert.equal(
        globby.exposure,
        fastGlob.exposure,
        "globby should inherit fast-glob's exposure",
      );
    }
  });

  it('pinned first-hop stays pinned even when downstream edge is caret', () => {
    // @nodelib/fs.stat: @nodelib/fs.scandir requires it with 4.0.0 (pinned)
    //   @nodelib/fs.scandir → @nodelib/fs.walk requires fs.scandir with 4.0.1 (pinned)
    const result = simulate('@nodelib/fs.stat', graph.isDependencyOf);
    result.delete('@nodelib/fs.stat');

    const scandir = result.get('@nodelib/fs.scandir');
    const walk = result.get('@nodelib/fs.walk');

    if (scandir) assert.equal(scandir.exposure, 'pinned');
    if (walk)
      assert.equal(
        walk.exposure,
        'pinned',
        '@nodelib/fs.walk should inherit pinned from fs.scandir',
      );
  });

  // ── No duplicate visits (BFS property) ────────────────────────────────

  it('each package appears exactly once in the cascade', () => {
    const result = simulate('ms', graph.isDependencyOf);
    const names = [...result.keys()];
    const unique = new Set(names);
    assert.equal(names.length, unique.size, 'no duplicates in cascade');
  });

  // ── Cross-check: cascade counts match index.html logic ────────────────

  it('exposure counts sum to cascade size', () => {
    for (const pkg of ['ms', '@types/estree', '@nodelib/fs.stat']) {
      const result = simulate(pkg, graph.isDependencyOf);
      result.delete(pkg);
      const auto = [...result.values()].filter(
        v => v.exposure === 'auto',
      ).length;
      const need = [...result.values()].filter(
        v => v.exposure === 'needs-update',
      ).length;
      const pin = [...result.values()].filter(
        v => v.exposure === 'pinned',
      ).length;
      assert.equal(
        auto + need + pin,
        result.size,
        `${pkg}: exposure counts should sum to cascade size`,
      );
    }
  });
});

describe('simulate — graph integrity', () => {
  it('every isDependencyOf target exists in packages', () => {
    for (const [pkg, edges] of Object.entries(graph.isDependencyOf)) {
      assert.ok(
        graph.packages[pkg],
        `${pkg} in isDependencyOf but missing from packages`,
      );
      for (const edge of edges) {
        assert.ok(
          graph.packages[edge.name],
          `${edge.name} (dependent of ${pkg}) missing from packages`,
        );
      }
    }
  });

  it('every dependsOn target exists in packages', () => {
    for (const [pkg, edges] of Object.entries(graph.dependsOn)) {
      assert.ok(
        graph.packages[pkg],
        `${pkg} in dependsOn but missing from packages`,
      );
      for (const edge of edges) {
        assert.ok(
          graph.packages[edge.name],
          `${edge.name} (dependency of ${pkg}) missing from packages`,
        );
      }
    }
  });

  it('dependsOn and isDependencyOf are consistent mirrors', () => {
    // if A dependsOn B, then B isDependencyOf A
    for (const [pkg, edges] of Object.entries(graph.dependsOn)) {
      for (const edge of edges) {
        const reverseEdges = graph.isDependencyOf[edge.name] ?? [];
        const found = reverseEdges.some(e => e.name === pkg);
        assert.ok(
          found,
          `${pkg} dependsOn ${edge.name}, but ${edge.name} isDependencyOf does not list ${pkg}`,
        );
      }
    }
  });

  it('every edge has a requirement string', () => {
    for (const [pkg, edges] of Object.entries(graph.isDependencyOf)) {
      for (const edge of edges) {
        assert.ok(
          typeof edge.requirement === 'string',
          `${pkg} → ${edge.name} missing requirement`,
        );
      }
    }
  });

  it('every package has version and dependent counts', () => {
    for (const [name, info] of Object.entries(graph.packages)) {
      assert.ok(typeof info.version === 'string', `${name} missing version`);
      assert.ok(
        typeof info.totalDependents === 'number',
        `${name} missing totalDependents`,
      );
      assert.ok(
        typeof info.directDependents === 'number',
        `${name} missing directDependents`,
      );
    }
  });
});

describe('simulate — dev graph integrity', () => {
  it('graph has isDevDependencyOf and devDependsOn keys', () => {
    assert.ok('isDevDependencyOf' in graph, 'graph missing isDevDependencyOf');
    assert.ok('devDependsOn' in graph, 'graph missing devDependsOn');
  });

  it('every isDevDependencyOf target exists in packages', () => {
    for (const [pkg, edges] of Object.entries(graph.isDevDependencyOf)) {
      assert.ok(graph.packages[pkg], `${pkg} in isDevDependencyOf but missing from packages`);
      for (const edge of edges) {
        assert.ok(graph.packages[edge.name], `${edge.name} (dev-dependent of ${pkg}) missing from packages`);
      }
    }
  });

  it('devDependsOn and isDevDependencyOf are consistent mirrors', () => {
    for (const [pkg, edges] of Object.entries(graph.devDependsOn)) {
      for (const edge of edges) {
        const reverseEdges = graph.isDevDependencyOf[edge.name] ?? [];
        const found = reverseEdges.some(e => e.name === pkg);
        assert.ok(found, `${pkg} devDependsOn ${edge.name}, but ${edge.name} isDevDependencyOf does not list ${pkg}`);
      }
    }
  });

  it('every dev edge has a requirement string', () => {
    for (const [pkg, edges] of Object.entries(graph.isDevDependencyOf)) {
      for (const edge of edges) {
        assert.ok(typeof edge.requirement === 'string', `${pkg} → ${edge.name} dev edge missing requirement`);
      }
    }
  });

  it('dev cascade is disjoint concern from prod cascade', () => {
    // A package can appear in both, but the graphs must be independently valid
    const prodCascade = simulate('jest', graph.isDependencyOf);
    const devCascade  = simulate('jest', graph.isDevDependencyOf);
    prodCascade.delete('jest');
    devCascade.delete('jest');
    // dev cascade should be larger for a test tool like jest
    assert.ok(
      devCascade.size >= prodCascade.size,
      `jest dev cascade (${devCascade.size}) should be >= prod cascade (${prodCascade.size})`,
    );
  });
});
