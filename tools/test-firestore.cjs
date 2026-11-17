const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const commands = [
  [process.execPath, ['--test', 'functions/firestore.rules.test.js']],
  [
    process.execPath,
    [
      'node_modules/deno/bin.cjs',
      'test',
      '--config',
      'supabase/functions/chat-api/deno.json',
      '--allow-env',
      '--allow-net=127.0.0.1:8080',
      'supabase/functions/chat-api/service.integration.ts',
    ],
  ],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, DEBUG: '' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
