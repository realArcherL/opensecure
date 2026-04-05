import { readFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface Edge { name: string; requirement: string; }

interface Graph {
  packages: Record<string, { version: string; weeklyDownloads: number; totalDependents: number }>;
  isDependencyOf: Record<string, Edge[]>;
}

// a range is "auto" if it allows new versions without manual intervention
function isAutoRange(req: string): boolean {
  const r = req.trim();
  if (r === '*' || r === '' || r === 'latest') return true;
  if (r.startsWith('^') || r.startsWith('~') || r.startsWith('>')) return true;
  return false;
}

export function simulate(pkg: string, graph: Graph) {
  const reverse = graph.isDependencyOf;
  // infected: name -> { depth, auto }
  const infected = new Map<string, { depth: number; auto: boolean }>();
  const queue: Array<[string, number, boolean]> = [[pkg, 0, true]];

  while (queue.length > 0) {
    const [current, depth, parentAuto] = queue.shift()!;
    if (infected.has(current)) continue;
    infected.set(current, { depth, auto: parentAuto });
    for (const edge of (reverse[current] ?? [])) {
      if (!infected.has(edge.name)) {
        // auto only if this edge is auto AND the parent chain was auto
        queue.push([edge.name, depth + 1, parentAuto && isAutoRange(edge.requirement)]);
      }
    }
  }

  infected.delete(pkg);

  const totalDownloads = [pkg, ...infected.keys()].reduce((sum, name) =>
    sum + (graph.packages[name]?.weeklyDownloads ?? 0), 0);

  const maxDepth = Math.max(0, ...[...infected.values()].map(v => v.depth));
  const autoExposed   = [...infected.values()].filter(v => v.auto).length;
  const manualExposed = infected.size - autoExposed;

  return { infected, maxDepth, totalDownloads, autoExposed, manualExposed };
}

const graph: Graph = JSON.parse(readFileSync('data/graph.json', 'utf-8'));
const arg = process.argv[2];

if (!arg) {
  console.error('Usage: npm run simulate <package> | --all');
  process.exit(1);
}

if (arg === '--all') {
  const results = Object.keys(graph.packages).map(pkg => {
    const { infected, totalDownloads, autoExposed } = simulate(pkg, graph);
    return { pkg, count: infected.size, autoExposed, totalDownloads };
  });

  results.sort((a, b) => b.count - a.count || b.totalDownloads - a.totalDownloads);

  console.log('\nWORST CASE SCENARIOS:');
  for (const [i, r] of results.entries()) {
    console.log(
      `${i + 1}. ${r.pkg.padEnd(22)} → ${r.count}/${Object.keys(graph.packages).length} cascade` +
      ` (${r.autoExposed} auto-pull, ${r.totalDownloads.toLocaleString()} dl/wk)`
    );
  }
} else {
  if (!graph.packages[arg]) {
    console.error(`Unknown package: ${arg}`);
    process.exit(1);
  }

  const { infected, maxDepth, totalDownloads, autoExposed, manualExposed } = simulate(arg, graph);

  log.info(`Package: ${arg}`);
  log.info(`Cascade: ${infected.size}/${Object.keys(graph.packages).length} packages`);
  log.info(`Auto-pull (^/~/>=): ${autoExposed} packages — receive malicious version on next install`);
  log.info(`Manual exposure:    ${manualExposed} packages — require deliberate update`);
  log.info(`Max depth: ${maxDepth} hops`);
  log.info(`Weekly downloads at risk: ${totalDownloads.toLocaleString()}`);

  if (infected.size > 0) {
    console.log('\nCascade:');
    for (const [name, { depth, auto }] of [...infected].sort((a, b) => a[1].depth - b[1].depth)) {
      console.log(`  hop ${depth}: ${name.padEnd(25)} ${auto ? '[auto-pull]' : '[manual]'}`);
    }
  }
}
