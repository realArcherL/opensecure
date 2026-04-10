import { readFileSync } from 'node:fs';
import { log } from './lib/log.js';

interface Edge { name: string; requirement: string; }

type ReverseGraph = Record<string, Edge[]>;

interface Graph {
  packages: Record<string, { version: string; totalDependents: number }>;
  isDependencyOf:    ReverseGraph;
  isDevDependencyOf: ReverseGraph;
}

function isAutoRange(req: string): boolean {
  const r = req.trim();
  if (r === '*' || r === '' || r === 'latest') return true;
  if (r.startsWith('^') || r.startsWith('~') || r.startsWith('>')) return true;
  return false;
}

export function simulate(pkg: string, isDependencyOf: ReverseGraph) {
  const infected = new Map<string, { depth: number; auto: boolean }>();
  const queue: Array<[string, number, boolean]> = [[pkg, 0, true]];

  while (queue.length > 0) {
    const [current, depth, parentAuto] = queue.shift()!;
    if (infected.has(current)) continue;
    infected.set(current, { depth, auto: parentAuto });
    for (const edge of (isDependencyOf[current] ?? [])) {
      if (!infected.has(edge.name)) {
        queue.push([edge.name, depth + 1, parentAuto && isAutoRange(edge.requirement)]);
      }
    }
  }

  infected.delete(pkg);
  return infected;
}

const graph: Graph = JSON.parse(readFileSync('data/graph.json', 'utf-8'));
const arg = process.argv[2];
const isDevMode = process.argv.includes('--dev');

if (!arg) {
  console.error('Usage: npm run simulate <package> [--dev] | --all [--dev]');
  process.exit(1);
}

const reverseGraph = isDevMode ? graph.isDevDependencyOf : graph.isDependencyOf;
const modeLabel = isDevMode ? 'dev' : 'prod';

if (arg === '--all') {
  const results = Object.keys(graph.packages).map(pkg => {
    const infected = simulate(pkg, reverseGraph);
    const autoExposed = [...infected.values()].filter(v => v.auto).length;
    return { pkg, count: infected.size, autoExposed };
  });

  results.sort((a, b) => b.count - a.count);

  console.log(`\nWORST CASE SCENARIOS (${modeLabel}):`);
  for (const [i, r] of results.entries()) {
    console.log(
      `${i + 1}. ${r.pkg.padEnd(22)} → ${r.count}/${Object.keys(graph.packages).length} cascade` +
      ` (${r.autoExposed} auto-pull)`
    );
  }
} else {
  if (!graph.packages[arg]) {
    console.error(`Unknown package: ${arg}`);
    process.exit(1);
  }

  const infected = simulate(arg, reverseGraph);
  const maxDepth = Math.max(0, ...[...infected.values()].map(v => v.depth));
  const autoExposed   = [...infected.values()].filter(v => v.auto).length;
  const manualExposed = infected.size - autoExposed;

  log.info(`Package: ${arg} [${modeLabel}]`);
  log.info(`Cascade: ${infected.size}/${Object.keys(graph.packages).length} packages`);
  log.info(`Auto-pull (^/~/>=): ${autoExposed} packages`);
  log.info(`Manual exposure:    ${manualExposed} packages`);
  log.info(`Max depth: ${maxDepth} hops`);

  if (infected.size > 0) {
    console.log('\nCascade:');
    for (const [name, { depth, auto }] of [...infected].sort((a, b) => a[1].depth - b[1].depth)) {
      console.log(`  hop ${depth}: ${name.padEnd(25)} ${auto ? '[auto-pull]' : '[manual]'}`);
    }
  }
}
