import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import {
  getPackageInfo,
  getDependencies,
  getDependentCount,
} from './lib/api.js';
import { log } from './lib/log.js';

const filename: string = process.argv[2] ?? 'data/top.json';
const packages: Array<{ name: string; rank: number }> = JSON.parse(
  readFileSync(filename, 'utf-8'),
);

const BATCH_SIZE  = 5;    // concurrent requests per batch
const BATCH_DELAY = 600;  // ms between batches — ~8 req/s average, respectful to deps.dev

mkdirSync('data/raw', { recursive: true });

function toFilename(name: string) {
  return name.replace(/\//g, '__');
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOne(name: string, index: number): Promise<void> {
  const file = `data/raw/${toFilename(name)}.json`;

  if (existsSync(file)) {
    log.info(`Skip ${index + 1}/${packages.length}: ${name}`);
    return;
  }

  try {
    const { version } = await getPackageInfo(name);

    const [depsData, dependentsData] = await Promise.all([
      getDependencies(name, version),
      getDependentCount(name, version),
    ]);

    const output = {
      name,
      version,
      fetchedAt: new Date().toISOString(),
      dependents: {
        direct: dependentsData.directDependentCount,
        indirect: dependentsData.indirectDependentCount,
        total: dependentsData.dependentCount,
      },
      dependencies:    depsData.dependencies,
      devDependencies: depsData.devDependencies,
    };

    if (dependentsData.missing)
      log.warn(`${name}@${version}: no dependent data on deps.dev, stored as 0`);

    writeFileSync(file, JSON.stringify(output, null, 2));
    log.info(
      `Fetched ${index + 1}/${packages.length}: ${name}@${version} — ${dependentsData.dependentCount.toLocaleString()} dependents`,
    );
  } catch (err) {
    log.error(`${index + 1}/${packages.length}: ${name} — ${(err as Error).message}`);
  }
}

for (let i = 0; i < packages.length; i += BATCH_SIZE) {
  const batch = packages.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map((pkg, j) => fetchOne(pkg.name, i + j)));
  if (i + BATCH_SIZE < packages.length) await delay(BATCH_DELAY);
}
