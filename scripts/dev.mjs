// `npm run dev`: gets a fresh or updated folder ready, then runs everything. Uses nothing outside Node, because
// node_modules may not exist yet. `--setup-only` stops after the setup.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === 'win32';
const shell = windows; // npm and npx are .cmd files there
const run = (command, args) => {
  const { status } = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell });
  if (status !== 0) process.exit(status ?? 1);
};

// Reinstalls when the lock file changed since the last install here.
function installDependencies() {
  const lock = createHash('sha256').update(readFileSync(join(root, 'package-lock.json'))).digest('hex');
  const stamp = join(root, 'node_modules', '.hyperion-lock');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === lock) return;
  console.log('Installing dependencies...');
  run('npm', ['ci']);
  writeFileSync(stamp, lock);
}

// One key per computer, kept outside the project: unpacking a new folder must not lose access to what the database
// has encrypted with it.
function secretsKey() {
  const file = join(homedir(), '.hyperion', 'dev-secrets-key');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const key = randomBytes(32).toString('base64');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

function prepareEnv() {
  const env = join(root, '.env');
  if (!existsSync(env)) copyFileSync(join(root, '.env.example'), env);
  const text = readFileSync(env, 'utf8');
  if (/^SECRETS_KEY=\S/m.test(text)) return;
  writeFileSync(env, text.replace(/^SECRETS_KEY=.*$/m, `SECRETS_KEY=${secretsKey()}`));
}

installDependencies();
prepareEnv();
if (process.argv.includes('--setup-only')) process.exit(0);

run('npm', ['run', 'db:up']);
run('npm', ['run', 'build', '-w', 'packages/shared']);

// The gaming PC also runs the companion. It's separate so a failed Rust build doesn't take the server down with it.
if (windows) {
  const cargo = spawnSync('cargo', ['--version'], { shell, stdio: 'ignore' });
  if (cargo.status === 0) spawn('npm', ['run', 'tauri', 'dev', '-w', 'apps/companion'], { cwd: root, stdio: 'inherit', shell });
  else console.log('Rust is not installed, so the companion was not started. See docs/WINDOWS_VERIFICATION.md.');
}

const server = spawn(
  'npx',
  ['concurrently', '-k', '-n', 'shared,server,web', '-c', 'green,blue,magenta', '"npm run dev:shared"', '"npm run dev:server"', '"npm run dev:web"'],
  { cwd: root, stdio: 'inherit', shell: true },
);
server.on('exit', (code) => process.exit(code ?? 0));
