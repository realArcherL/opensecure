import { readFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface Graph {
  packages: Record<string, { version: string; totalDependents: number }>;
  isDependencyOf: Record<string, string[]>;
}

export function simulate(pkg: string, graph: Graph) {
  const reverse = graph.isDependencyOf;
  const infected = new Map<string, number>(); // name -> depth
  const queue: Array<[string, number]> = [[pkg, 0]];

  while (queue.length > 0) {
    const [current, depth] = queue.shift()!;
    if (infected.has(current)) continue;
    infected.set(current, depth);
    for (const dependent of (reverse[current] ?? [])) {
      if (!infected.has(dependent)) queue.push([dependent, depth + 1]);
    }
  }

  infected.delete(pkg);

  // start with the compromised package's own dependents, then add cascade
  const ownDependents = graph.packages[pkg]?.totalDependents ?? 0;
  const totalDownloads = ownDependents + [...infected.keys()].reduce((sum, name) => {
    return sum + (graph.packages[name]?.totalDependents ?? 0);
  }, 0);

  return { infected, maxDepth: Math.max(0, ...[...infected.values()]), totalDownloads };
}

const graph: Graph = JSON.parse(readFileSync('data/graph.json', 'utf-8'));
const arg = process.argv[2];

if (!arg) {
  console.error('Usage: npm run simulate <package> | --all');
  process.exit(1);
}

if (arg === '--all') {
  const results = Object.keys(graph.packages).map(pkg => {
    const { infected, totalDownloads } = simulate(pkg, graph);
    return { pkg, count: infected.size, totalDownloads };
  });

  results.sort((a, b) => b.count - a.count);

  console.log('\nWORST CASE SCENARIOS:');
  for (const [i, r] of results.entries()) {
    console.log(`${i + 1}. ${r.pkg.padEnd(20)} → infects ${r.count}/${Object.keys(graph.packages).length} (${r.totalDownloads.toLocaleString()} dependents affected)`);
  }
} else {
  if (!graph.packages[arg]) {
    console.error(`Unknown package: ${arg}`);
    process.exit(1);
  }

  const { infected, maxDepth, totalDownloads } = simulate(arg, graph);

  log.info(`Package: ${arg}`);
  log.info(`Directly infects: ${[...infected].filter(([,d]) => d === 1).length}`);
  log.info(`Total cascade: ${infected.size}/${Object.keys(graph.packages).length}`);
  log.info(`Max depth: ${maxDepth} hops`);
  log.info(`Affected dependents (upper bound, may double-count): ${totalDownloads.toLocaleString()}`);

  if (infected.size > 0) {
    console.log('\nInfected packages:');
    for (const [name, depth] of [...infected].sort((a, b) => a[1] - b[1])) {
      console.log(`  hop ${depth}: ${name}`);
    }
  }
}
