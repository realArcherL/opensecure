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

export async function getPackageInfo(
  name: string,
): Promise<{ version: string }> {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(
    `${BASE}/v3/systems/npm/packages/${encoded}`,
  );
  if (!res.ok) throw new Error(`getPackageInfo ${name}: ${res.status}`);
  const data = (await res.json()) as {
    versions: Array<{ versionKey: { version: string }; isDefault: boolean }>;
  };
  const def = data.versions.find(v => v.isDefault);
  if (!def) throw new Error(`getPackageInfo ${name}: no default version`);
  return { version: def.versionKey.version };
}

export async function getDependencies(
  name: string,
  version: string,
): Promise<{
  dependencies: Array<{ name: string; requirement: string }>;
  devDependencies: Array<{ name: string; requirement: string }>;
}> {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(
    `${BASE}/v3alpha/systems/npm/packages/${encoded}/versions/${encodeURIComponent(version)}:requirements`,
  );
  if (res.status === 404) return { dependencies: [], devDependencies: [] };
  if (!res.ok) throw new Error(`getDependencies ${name}@${version}: ${res.status}`);
  const data = await res.json() as {
    npm?: { dependencies?: {
      dependencies?: Array<{ name: string; requirement: string }>;
      devDependencies?: Array<{ name: string; requirement: string }>;
    }};
  };
  return {
    dependencies:    data.npm?.dependencies?.dependencies    ?? [],
    devDependencies: data.npm?.dependencies?.devDependencies ?? [],
  };
}

export async function getDependentCount(name: string, version: string) {
  const encoded = encodeURIComponent(name);
  const res = await fetchWithRetry(
    `${BASE}/v3alpha/systems/npm/packages/${encoded}/versions/${version}:dependents`,
  );
  if (res.status === 404)
    return {
      dependentCount: 0,
      directDependentCount: 0,
      indirectDependentCount: 0,
      missing: true,
    };
  if (!res.ok)
    throw new Error(`getDependentCount ${name}@${version}: ${res.status}`);
  return res.json() as Promise<{
    dependentCount: number;
    directDependentCount: number;
    indirectDependentCount: number;
    missing?: boolean;
  }>;
}
