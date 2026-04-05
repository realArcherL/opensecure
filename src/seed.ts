import { writeFileSync, mkdirSync } from 'node:fs';
import { npmTopDownloads, npmTopDependents } from 'npm-high-impact';

interface Package {
  name: string;
  rank: number;
  source: 'downloads' | 'dependents';
}

const count: number = parseInt(process.argv[2] ?? '100') || 100;

const seen = new Set<string>();
const packages: Package[] = [];

for (const name of npmTopDownloads) {
  if (packages.length >= count) break;
  if (seen.has(name)) continue;
  seen.add(name);
  packages.push({ name, rank: packages.length + 1, source: 'downloads' });
}

for (const name of npmTopDependents) {
  if (packages.length >= count) break;
  if (seen.has(name)) continue;
  seen.add(name);
  packages.push({ name, rank: packages.length + 1, source: 'dependents' });
}

mkdirSync('data', { recursive: true });
writeFileSync(`data/top${count}.json`, JSON.stringify(packages, null, 2));
console.log(`Wrote ${packages.length} packages to data/top${count}.json`);
