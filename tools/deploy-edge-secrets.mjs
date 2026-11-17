import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const credentialPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credentialPath) throw new Error('Indica la ruta del JSON administrativo de Firebase');
const account = JSON.parse(readFileSync(credentialPath, 'utf8').replace(/^\uFEFF/, ''));
if (account.project_id !== 'chat-dual-f31e5' || !account.private_key || !account.client_email) {
  throw new Error('La credencial debe corresponder a chat-dual-f31e5');
}
const cli = join(root, 'node_modules/supabase/dist/supabase.js');
if (!existsSync(cli)) throw new Error('Ejecuta npm install para instalar la CLI de Supabase');
const directory = mkdtempSync(join(tmpdir(), 'chat-dual-edge-'));
const filename = join(directory, 'firebase.env');
try {
  writeFileSync(filename, `FIREBASE_SERVICE_ACCOUNT=${JSON.stringify(account)}\n`, { mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [cli, 'secrets', 'set', '--env-file', filename, '--remote=lcmrvlnxpnzgqgiwzxpv', '--yes'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DEBUG: '' },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(filename);
  rmdirSync(directory);
}
