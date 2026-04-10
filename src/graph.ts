import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface RawPackage {
  name: string;
  version: string;
  dependents: { direct?: number; indirect?: number; total?: number };
  dependencies:    Array<{ name: string; requirement: string }>;
  devDependencies: Array<{ name: string; requirement: string }>;
}

const files = readdirSync('data/raw').filter(f => f.endsWith('.json'));
const raws: RawPackage[] = files.map(f =>
  JSON.parse(readFileSync(`data/raw/${f}`, 'utf-8')),
);

const topSet = new Set(raws.map(r => r.name));

const packages: Record<
  string,
  {
    version: string;
    totalDependents: number;
    directDependents: number;
    indirectDependents: number;
  }
> = {};
const dependsOn:         Record<string, Array<{ name: string; requirement: string }>> = {};
const isDependencyOf:    Record<string, Array<{ name: string; requirement: string }>> = {};
const devDependsOn:      Record<string, Array<{ name: string; requirement: string }>> = {};
const isDevDependencyOf: Record<string, Array<{ name: string; requirement: string }>> = {};

for (const pkg of raws) {
  packages[pkg.name] = {
    version: pkg.version,
    totalDependents: pkg.dependents?.total ?? 0,
    directDependents: pkg.dependents?.direct ?? 0,
    indirectDependents: pkg.dependents?.indirect ?? 0,
  };

  const buildEdges = (list: Array<{ name: string; requirement: string }>) => {
    const seen = new Set<string>();
    return list
      .filter(e => topSet.has(e.name) && !seen.has(e.name) && seen.add(e.name))
      .map(e => ({ name: e.name, requirement: e.requirement ?? '*' }));
  };

  const prodEdges = buildEdges(pkg.dependencies ?? []);
  dependsOn[pkg.name] = prodEdges;
  for (const { name: dep, requirement } of prodEdges) {
    if (!isDependencyOf[dep]) isDependencyOf[dep] = [];
    if (!isDependencyOf[dep].find(e => e.name === pkg.name))
      isDependencyOf[dep].push({ name: pkg.name, requirement });
  }

  const devEdges = buildEdges(pkg.devDependencies ?? []);
  devDependsOn[pkg.name] = devEdges;
  for (const { name: dep, requirement } of devEdges) {
    if (!isDevDependencyOf[dep]) isDevDependencyOf[dep] = [];
    if (!isDevDependencyOf[dep].find(e => e.name === pkg.name))
      isDevDependencyOf[dep].push({ name: pkg.name, requirement });
  }
}

const graph = {
  generatedAt: new Date().toISOString(),
  packageCount: raws.length,
  packages,
  dependsOn,
  isDependencyOf,
  devDependsOn,
  isDevDependencyOf,
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
