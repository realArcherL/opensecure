/**
 * Shared helpers — mirrors the logic embedded in index.html
 * so tests can verify it independently.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ── Exposure type classification ──────────────────────────────────────────
// Determines how a dependency range behaves on `npm install`:
//   auto         – range allows new patch/minor (^, ~, >=, bare)
//   pinned       – exact version (1.4.0)
//   needs-update – anything else (git:, url, workspace:, etc.)

export function exposureType(req) {
  const r = (req ?? '*').trim();
  if (!r || r === '*' || r === 'latest') return 'auto';
  if (r.startsWith('^') || r.startsWith('~') || r.startsWith('>'))
    return 'auto';
  // bare numbers: "1", "1.4", "1.x", "1.x.x", "1.*" — npm treats as range
  if (/^\d+(\.(x|\*|\d+))?(\.x|\.\*)?$/.test(r) && !/^\d+\.\d+\.\d+$/.test(r))
    return 'auto';
  // exact pin: 1.4.0
  if (/^\d+\.\d+\.\d+$/.test(r)) return 'pinned';
  return 'needs-update';
}

// ── Cascade simulation (BFS) ─────────────────────────────────────────────
// Given a compromised package, walks isDependencyOf edges to find all
// downstream packages that could be affected.
// Key rule: only the depth-0 edge determines exposure; deeper hops inherit.

export function simulate(pkg, isDependencyOf) {
  const infected = new Map(); // name → { depth, exposure }
  const queue = [[pkg, 0, 'auto']];
  while (queue.length) {
    const [cur, depth, parentExposure] = queue.shift();
    if (infected.has(cur)) continue;
    infected.set(cur, { depth, exposure: parentExposure });
    for (const edge of isDependencyOf[cur] ?? []) {
      if (!infected.has(edge.name)) {
        const edgeType = exposureType(edge.requirement);
        const childExposure = depth === 0 ? edgeType : parentExposure;
        queue.push([edge.name, depth + 1, childExposure]);
      }
    }
  }
  return infected;
}

// ── Graph loader ─────────────────────────────────────────────────────────

export async function loadGraph() {
  const raw = await readFile(join(DATA_DIR, 'graph.json'), 'utf-8');
  return JSON.parse(raw);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────

export async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'opensecure-test/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}
