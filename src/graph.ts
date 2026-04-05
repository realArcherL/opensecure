import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface RawPackage {
  name: string;
  version: string;
  downloads: { version: string; weekly: number; daily: number; hourly: number };
  dependents: { direct?: number; indirect?: number; total?: number };
  dependencies: {
    nodes: Array<{ name: string; version: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}

const files = readdirSync('data/raw').filter(f => f.endsWith('.json'));
const raws: RawPackage[] = files.map(f =>
  JSON.parse(readFileSync(`data/raw/${f}`, 'utf-8')),
);

const topSet = new Set(raws.map(r => r.name));

const packages: Record<string, { version: string; weeklyDownloads: number; totalDependents: number }> = {};
const dependsOn: Record<string, string[]> = {};
const isDependencyOf: Record<string, string[]> = {};

for (const pkg of raws) {
  packages[pkg.name] = {
    version: pkg.version,
    weeklyDownloads: pkg.downloads?.weekly ?? 0,
    totalDependents: pkg.dependents?.total ?? 0,
  };

  const deps = pkg.dependencies.nodes
    .map(n => n.name)
    .filter(n => n !== pkg.name && topSet.has(n));

  dependsOn[pkg.name] = [...new Set(deps)];

  for (const dep of dependsOn[pkg.name]) {
    if (!isDependencyOf[dep]) isDependencyOf[dep] = [];
    if (!isDependencyOf[dep].includes(pkg.name)) {
      isDependencyOf[dep].push(pkg.name);
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
