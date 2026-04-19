import { readFileSync, writeFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface Edge { name: string; requirement: string; }
type ReverseGraph = Record<string, Edge[]>;

interface Graph {
  packages: Record<string, { version: string; totalDependents: number }>;
  isDependencyOf:    ReverseGraph;
  isDevDependencyOf: ReverseGraph;
}

function exposureType(req: string): 'auto' | 'pinned' {
  const r = (req ?? '*').trim();
  if (!r || r === '*' || r === 'latest') return 'auto';
  if (r.startsWith('^') || r.startsWith('~') || r.startsWith('>')) return 'auto';
  if (/^\d+(\.(x|\*|\d+))?(\.x|\.\*)?$/.test(r) && !/^\d+\.\d+\.\d+$/.test(r)) return 'auto';
  return 'pinned';
}

function cascadeSize(pkg: string, reverseGraph: ReverseGraph): number {
  const visited = new Set<string>();
  const queue = [pkg];
  while (queue.length) {
    const cur = queue.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const edge of (reverseGraph[cur] ?? [])) {
      if (!visited.has(edge.name)) queue.push(edge.name);
    }
  }
  visited.delete(pkg);
  return visited.size;
}

const graph: Graph = JSON.parse(readFileSync('data/graph.json', 'utf-8'));
const names = Object.keys(graph.packages);

log.info(`Pre-computing cascade sizes for ${names.length} packages…`);

const runtimeSizes: Record<string, number> = {};
const toolingSizes: Record<string, number> = {};

for (let i = 0; i < names.length; i++) {
  const name = names[i];
  runtimeSizes[name] = cascadeSize(name, graph.isDependencyOf);
  toolingSizes[name] = cascadeSize(name, graph.isDevDependencyOf);
  if ((i + 1) % 500 === 0 || i + 1 === names.length) log.info(`  ${i + 1}/${names.length}`);
}

const maxRuntimeSize = Math.max(0, ...Object.values(runtimeSizes));
const maxToolingSize = Math.max(0, ...Object.values(toolingSizes));

function sortBySize(sizes: Record<string, number>) {
  return [...names]
    .sort((a, b) =>
      sizes[b] - sizes[a] ||
      (graph.packages[b].totalDependents ?? 0) - (graph.packages[a].totalDependents ?? 0) ||
      a.localeCompare(b)
    )
    .map(n => ({ name: n, size: sizes[n] }));
}

const out = {
  runtimeSorted: sortBySize(runtimeSizes),
  toolingSorted: sortBySize(toolingSizes),
  maxRuntimeSize,
  maxToolingSize,
};

writeFileSync('data/sizes.json', JSON.stringify(out));
log.info(`Wrote data/sizes.json (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
