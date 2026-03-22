const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cli-pack-smoke-'));

main();

function main() {
  const packDir = path.join(tmpRoot, 'pack');
  const installDir = path.join(tmpRoot, 'install');
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });

  try {
    runCommand(npmCommand(), ['pack', '--pack-destination', packDir], { cwd: repoRoot });
    const tarball = findTarball(packDir);

    fs.writeFileSync(path.join(installDir, 'package.json'), JSON.stringify({
      name: 'video-cli-pack-smoke',
      private: true,
      version: '0.0.0'
    }, null, 2) + '\n');

    runCommand(npmCommand(), [
      'install',
      '--no-audit',
      '--no-fund',
      '--no-package-lock',
      tarball,
    ], { cwd: installDir });

    const installedPackageDir = path.join(installDir, 'node_modules', 'video-cli');
    const installedBinPath = path.join(
      installDir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'video-cli.cmd' : 'video-cli'
    );

    assert.ok(fs.existsSync(installedPackageDir), 'installed package directory is missing');
    assert.ok(fs.existsSync(installedBinPath), 'installed cli bin wrapper is missing');

    const help = runCommand(installedBinPath, ['--help'], {
      cwd: installDir,
      env: smokeEnv(installDir),
    }).stdout;
    assert.match(help, /Quick Start:/);
    assert.match(help, /install --skills/);

    const config = JSON.parse(runCommand(installedBinPath, ['config'], {
      cwd: installDir,
      env: smokeEnv(installDir),
    }).stdout);
    assert.equal(config.preset, 'balanced');
    assert.equal(config.ocr.provider, 'gemini');
    assert.equal(config.embed.dimensions, 768);

    console.log('packed install smoke test passed');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function smokeEnv(installDir) {
  return {
    ...process.env,
    VIDEO_CLI_DATA_ROOT: path.join(installDir, '.tmp_data'),
  };
}

function findTarball(packDir) {
  const tarball = fs.readdirSync(packDir)
    .filter(name => name.endsWith('.tgz'))
    .map(name => path.join(packDir, name))
    .sort()[0];

  if (!tarball) {
    throw new Error('npm pack did not produce a tarball');
  }

  return tarball;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runCommand(command, args, options = {}) {
  const useCmdShim = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
  const result = spawnSync(
    useCmdShim ? (process.env.ComSpec || 'cmd.exe') : command,
    useCmdShim ? ['/d', '/s', '/c', command, ...args] : args,
    {
      cwd: options.cwd || repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    }
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with code ${result.status}`);
  }

  return result;
}
