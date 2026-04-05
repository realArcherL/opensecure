import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  getPackageInfo,
  getDependencies,
  getDependentCount,
} from './lib/api.js';
import { log } from './lib/log.js';

const filename: string = process.argv[2] ?? 'data/top100.json';
const packages: Array<{ name: string; rank: number }> = JSON.parse(
  readFileSync(filename, 'utf-8'),
);

const DELAY_MS = 300; // conservative delay between packages, deps.dev has no published rate limit

mkdirSync('data/raw', { recursive: true });

function toFilename(name: string) {
  return name.replace(/\//g, '__');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (let i = 0; i < packages.length; i++) {
  const { name } = packages[i];
  const file = `data/raw/${toFilename(name)}.json`;

  if (existsSync(file)) {
    log.info(`Skip ${i + 1}/${packages.length}: ${name}`);
    continue;
  }

  try {
    const { version } = await getPackageInfo(name);

    const [depsData, dependentsData] = await Promise.all([
      getDependencies(name, version),
      getDependentCount(name, version),
    ]);

    const nodes = depsData.nodes.map(n => ({
      name: n.versionKey.name,
      version: n.versionKey.version,
    }));

    const edges = depsData.edges.map(e => ({
      from: depsData.nodes[e.fromNode].versionKey.name,
      to: depsData.nodes[e.toNode].versionKey.name,
    }));

    const output = {
      name,
      version,
      fetchedAt: new Date().toISOString(),
      dependents: {
        direct: dependentsData.directDependentCount,
        indirect: dependentsData.indirectDependentCount,
        total: dependentsData.dependentCount,
      },
      dependencies: { nodes, edges },
    };

    writeFileSync(file, JSON.stringify(output, null, 2));
    log.info(
      `Fetched ${i + 1}/${packages.length}: ${name} (${nodes.length} dep nodes, ${dependentsData.dependentCount} total dependents)`,
    );
  } catch (err) {
    log.error(
      `${i + 1}/${packages.length}: ${name} — ${(err as Error).message}`,
    );
  }

  await delay(DELAY_MS);
}
