import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface RawPackage {
  name: string;
  version: string;
  downloads: { version: string; weekly: number; daily: number; hourly: number };
  dependents: { direct?: number; indirect?: number; total?: number };
  dependencies: {
    nodes: Array<{ name: string; version: string }>;
    edges: Array<{ from: string; to: string; requirement: string }>;
  };
}

const files = readdirSync('data/raw').filter(f => f.endsWith('.json'));
const raws: RawPackage[] = files.map(f =>
  JSON.parse(readFileSync(`data/raw/${f}`, 'utf-8')),
);

const topSet = new Set(raws.map(r => r.name));

const packages: Record<string, { version: string; weeklyDownloads: number; totalDependents: number }> = {};
// edge: from depends on `to` via `requirement` semver range
const dependsOn: Record<string, Array<{ name: string; requirement: string }>> = {};
// reverse: `pkg` is pulled in by these packages, with the range they use
const isDependencyOf: Record<string, Array<{ name: string; requirement: string }>> = {};

for (const pkg of raws) {
  packages[pkg.name] = {
    version: pkg.version,
    weeklyDownloads: pkg.downloads?.weekly ?? 0,
    totalDependents: pkg.dependents?.total ?? 0,
  };

  // keep only intra-set edges, deduplicate by `to` name
  const seen = new Set<string>();
  const edges: Array<{ name: string; requirement: string }> = [];
  for (const e of pkg.dependencies.edges) {
    if (e.from === pkg.name && topSet.has(e.to) && !seen.has(e.to)) {
      seen.add(e.to);
      edges.push({ name: e.to, requirement: e.requirement ?? '*' });
    }
  }
  dependsOn[pkg.name] = edges;

  for (const { name: dep, requirement } of edges) {
    if (!isDependencyOf[dep]) isDependencyOf[dep] = [];
    if (!isDependencyOf[dep].find(e => e.name === pkg.name)) {
      isDependencyOf[dep].push({ name: pkg.name, requirement });
    }
  }
}

const graph = {
  generatedAt: new Date().toISOString(),
  packageCount: raws.length,
  packages,
  dependsOn,
  isDependencyOf,
};

writeFileSync('data/graph.json', JSON.stringify(graph, null, 2));

const connected = Object.values(dependsOn).filter(d => d.length > 0).length;
const isolated = raws.length - connected;
const depCounts = Object.entries(isDependencyOf)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 5);

log.info(`Packages with no intra-set deps: ${isolated}`);
log.info(
  `Packages depended on by others: ${Object.keys(isDependencyOf).length}`,
);
log.info(`Top 5: ${depCounts.map(([n, d]) => `${n}(${d.length})`).join(', ')}`);
