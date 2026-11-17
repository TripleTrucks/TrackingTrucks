import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(join(root, '.env'), 'utf8');
const variables = parseEnv(source);
if (!variables.API_PRIVATE_KEY?.trim()) throw new Error('.env is missing API_PRIVATE_KEY');
const frontend = Object.fromEntries(Object.entries(variables).filter((entry): entry is [string, string] => entry[0].startsWith('VITE_') && typeof entry[1] === 'string'));
const kubeconfig = join(homedir(), '.kube', 'trackingtrucks-k3s.yaml');
const env = { ...process.env };
if (!env.KUBECONFIG && existsSync(kubeconfig)) env.KUBECONFIG = kubeconfig;

for (const namespace of ['staging', 'production', 'testing']) {
  const secrets: Record<string, Record<string, string>> = {
    'trackingtrucks-env': { '.env': source },
    'frontend-env': frontend,
    'backend-env': { API_PRIVATE_KEY: variables.API_PRIVATE_KEY },
  };
  for (const [name, values] of Object.entries(secrets)) {
    const secret = {
      apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name, namespace },
      data: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Buffer.from(value).toString('base64')])),
    };
    // Pass secrets through stdin, never command-line arguments, logs or files.
    const result = spawnSync('kubectl', ['apply', '--server-side', '--field-manager=trackingtrucks-env', '-f', '-'], {
      env, input: JSON.stringify(secret), encoding: 'utf8',
    });
    if (result.error || result.status !== 0) {
      // API errors can echo submitted objects, so don't print their payloads.
      throw new Error(`Could not sync ${namespace}/${name}; check cluster access and Secret field ownership.`);
    }
  }
  console.log(`${namespace}: stored .env; synced frontend build variables and backend runtime key.`);
}
if (!frontend.VITE_GEOAPIFY_API_KEY?.trim()) {
  console.log('Routing key is missing: add VITE_GEOAPIFY_API_KEY to .env, sync again, and rebuild.');
}
