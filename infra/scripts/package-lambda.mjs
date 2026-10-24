// Builds the deployable resize Lambda into infra/build/resize.
// sharp ships a native binary per platform; installing here with --os=linux --cpu=arm64 fetches the
// one the Lambda runtime (Amazon Linux 2023, Graviton) needs, even when this runs on Windows or macOS.
// No Docker required.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../lambda/resize/', import.meta.url));
const out = fileURLToPath(new URL('../build/resize/', import.meta.url));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.mjs', 'variants.mjs', 'package.json']) cpSync(src + f, out + f);

execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--os=linux', '--cpu=arm64', '--libc=glibc'], {
  cwd: out,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log(`\nResize Lambda packaged at ${out}`);
