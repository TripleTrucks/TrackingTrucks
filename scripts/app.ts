import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file is compiled into .cache/scripts before npm invokes it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const windows = process.platform === 'win32';
const children = new Set<ChildProcess>();

function stopChildren() {
  for (const child of children) {
    if (!child.pid) continue;
    if (windows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
    }
  }
}
process.on('SIGINT', () => { stopChildren(); process.exitCode = 130; });
process.on('SIGTERM', () => { stopChildren(); process.exitCode = 143; });

function run(command: string, args: string[], cwd = root, env = process.env): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: !windows });
    children.add(child);
    child.once('error', error => { children.delete(child); reject(error); });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

async function dotnet(): Promise<string> {
  const executable = windows ? 'dotnet.exe' : 'dotnet';
  const installDir = resolve(process.env.TRACKINGTRUCKS_DOTNET_DIR || join(homedir(), '.dotnet8'));
  const candidates = [
    join(installDir, executable),
    ...(process.env.DOTNET_ROOT ? [join(process.env.DOTNET_ROOT, executable)] : []),
    'dotnet',
  ];
  const hasEight = (candidate: string) => {
    const sdk = spawnSync(candidate, ['--list-sdks'], { encoding: 'utf8' });
    const runtime = spawnSync(candidate, ['--list-runtimes'], { encoding: 'utf8' });
    return sdk.status === 0 && /^8\./m.test(sdk.stdout ?? '') &&
      /^Microsoft.AspNetCore.App 8\./m.test(runtime.stdout ?? '');
  };
  let selected = candidates.find(hasEight);
  if (!selected) {
    console.log('Installing .NET 8 SDK and ASP.NET runtime into ' + installDir);
    const extension = windows ? 'ps1' : 'sh';
    const response = await fetch(`https://dot.net/v1/dotnet-install.${extension}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`.NET installer download failed: HTTP ${response.status}`);
    await mkdir(join(root, '.cache'), { recursive: true });
    const installer = join(root, '.cache', `dotnet-install.${extension}`);
    await writeFile(installer, await response.text());
    if (windows) {
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer,
        '-Channel', '8.0', '-InstallDir', installDir, '-NoPath']);
    } else {
      await run('bash', [installer, '--channel', '8.0', '--install-dir', installDir, '--no-path']);
    }
    selected = join(installDir, executable);
    if (!hasEight(selected)) throw new Error('.NET 8 installation did not complete successfully.');
  }
  if (selected !== 'dotnet') {
    process.env.DOTNET_ROOT = dirname(selected);
    process.env.PATH = `${dirname(selected)}${delimiter}${process.env.PATH ?? ''}`;
  }
  process.env.DOTNET_CLI_TELEMETRY_OPTOUT = '1';
  return selected;
}

async function main() {
  const mode = process.argv[2];
  if (!['dev', 'build', 'start', 'setup'].includes(mode)) throw new Error('Expected dev, build, start or setup.');
  console.log(`App command: ${mode}; Node ${process.version} (${process.platform}/${process.arch})`);
  const dotnetPath = await dotnet();
  const backend = join(root, 'Backend');
  const output = join(root, 'build', 'app');
  if (mode === 'setup') return;
  if (mode === 'dev') {
    await Promise.race([
      run(dotnetPath, ['run', '--project', 'Backend.csproj', '--no-launch-profile'], backend, {
        ...process.env, ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'http://127.0.0.1:62926',
      }),
      run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), ...process.argv.slice(3)]),
    ]);
  } else if (mode === 'build') {
    console.log('Build: TypeScript check');
    await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
    console.log('Build: Vite frontend bundle');
    await run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
    await rm(output, { recursive: true, force: true });
    console.log('Build: .NET backend publish');
    await run(dotnetPath, ['publish', 'Backend.csproj', '-c', 'Release', '-o', output, '--self-contained', 'false'], backend);
    await cp(join(root, 'dist'), join(output, 'wwwroot'), { recursive: true });
  } else {
    if (!existsSync(join(output, 'Backend.dll'))) throw new Error('Run npm run build before npm start.');
    await run(dotnetPath, [join(output, 'Backend.dll')], output, {
      ...process.env,
      ASPNETCORE_ENVIRONMENT: process.env.ASPNETCORE_ENVIRONMENT || 'Production',
      ASPNETCORE_URLS: process.env.ASPNETCORE_URLS || 'http://127.0.0.1:5173',
    });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode ||= 1;
}).finally(stopChildren);
