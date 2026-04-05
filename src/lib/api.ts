const BASE = 'https://api.deps.dev';

async function fetchWithRetry(url: string): Promise<Response> {
  const res = await fetch(url);
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const wait = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
    await new Promise(r => setTimeout(r, wait));
    return fetch(url);
  }
  return res;
}

export async function getPackageInfo(name: string): Promise<{ version: string }> {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(`${BASE}/v3/systems/npm/packages/${encoded}`);
  if (!res.ok) throw new Error(`getPackageInfo ${name}: ${res.status}`);
  const data = await res.json() as { versions: Array<{ versionKey: { version: string }; isDefault: boolean }> };
  const def = data.versions.find(v => v.isDefault);
  if (!def) throw new Error(`getPackageInfo ${name}: no default version`);
  return { version: def.versionKey.version };
}

export async function getDependencies(name: string, version: string) {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(`${BASE}/v3/systems/npm/packages/${encoded}/versions/${version}:dependencies`);
  if (res.status === 404) return { nodes: [], edges: [] };
  if (!res.ok) throw new Error(`getDependencies ${name}@${version}: ${res.status}`);
  return res.json() as Promise<{
    nodes: Array<{ versionKey: { name: string; version: string } }>;
    edges: Array<{ fromNode: number; toNode: number }>;
  }>;
}

export async function getDownloads(name: string, version: string): Promise<{
  version: string;    // the version these download counts apply to
  weekly: number;     // last 7 days (npm API: last-week)
  daily: number;      // last 24 hours (npm API: last-day)
  hourly: number;     // derived: daily / 24 — npm has no sub-daily resolution
}> {
  const encoded = encodeURIComponent(name);
  const [weekRes, dayRes] = await Promise.all([
    fetch(`https://api.npmjs.org/downloads/point/last-week/${encoded}`),
    fetch(`https://api.npmjs.org/downloads/point/last-day/${encoded}`),
  ]);
  const weekly = weekRes.ok ? ((await weekRes.json()) as { downloads: number }).downloads ?? 0 : 0;
  const daily  = dayRes.ok  ? ((await dayRes.json())  as { downloads: number }).downloads ?? 0 : 0;
  return { version, weekly, daily, hourly: Math.round(daily / 24) };
}

export async function getDependentCount(name: string, version: string) {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(`${BASE}/v3alpha/systems/npm/packages/${encoded}/versions/${version}:dependents`);
  if (res.status === 404) return { dependentCount: 0, directDependentCount: 0, indirectDependentCount: 0, missing: true };
  if (!res.ok) throw new Error(`getDependentCount ${name}@${version}: ${res.status}`);
  return res.json() as Promise<{ dependentCount: number; directDependentCount: number; indirectDependentCount: number; missing?: boolean }>;
}
