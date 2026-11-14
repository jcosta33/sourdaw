'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
assert.ok(process.env.PACKAGING_REQUIRE_FROM, 'set the integrated lane package.json');
const laneRequire = require('../fixtures/installed-require.cjs').packageRequire;
const appRequire = createRequire(laneRequire.resolve('app-builder-lib/package.json'));
async function withDirectory(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-closure-'));
    try {
        return await run(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

test('real lock ownership, retry refusal, release and signal-exit cleanup remain observable', async () =>
    withDirectory(async (dir) => {
        const lockfile = appRequire('proper-lockfile');
        const file = path.join(dir, 'artifact.lock-target');
        await fs.writeFile(file, 'fixture');
        const release = await lockfile.lock(file, { retries: 0 });
        assert.equal(await lockfile.check(file), true);
        await assert.rejects(lockfile.lock(file, { retries: 0 }), (error) => error.code === 'ELOCKED');
        await release();
        assert.equal(await lockfile.check(file), false);
        const releaseSync = lockfile.lockSync(file);
        assert.equal(lockfile.checkSync(file), true);
        releaseSync();
        const child = spawnSync(process.execPath, [path.join(__dirname, '../fixtures/lock-exit-worker.cjs'), file], {
            encoding: 'utf8',
            timeout: 10000,
            env: process.env,
        });
        assert.equal(child.error, undefined);
        assert.equal(child.status, 0, child.stderr);
        assert.match(child.stdout, /LOCK_ACQUIRED/);
        await assert.rejects(fs.stat(file + '.lock'), (error) => error.code === 'ENOENT');
    }));
test('cross-spawn actual executable resolution retains custom PATH, cwd and ENOENT', async () =>
    withDirectory(async (dir) => {
        const utilRequire = createRequire(appRequire.resolve('builder-util/package.json'));
        const spawnRoot = path.dirname(utilRequire.resolve('cross-spawn/package.json'));
        const resolveCommand = require(path.join(spawnRoot, 'lib/util/resolveCommand.js'));
        const pathKey = createRequire(path.join(spawnRoot, 'package.json'))('path-key').default;
        assert.equal(pathKey({ env: { Path: 'one', PATH: 'two' }, platform: 'win32' }), 'PATH');
        const bin = path.join(dir, 'bin');
        await fs.mkdir(bin);
        const extension = process.platform === 'win32' ? '.cmd' : '';
        const command = path.join(bin, 'sourdaw-fixture-tool' + extension);
        await fs.writeFile(command, process.platform === 'win32' ? '@echo fixture' : '#!/bin/sh\nprintf fixture', {
            mode: 0o755,
        });
        const env = process.platform === 'win32' ? { Path: bin, PATHEXT: '.CMD;.EXE' } : { PATH: bin };
        const resolved = resolveCommand({
            command: 'sourdaw-fixture-tool',
            options: { cwd: dir, env },
        });
        assert.equal(await fs.realpath(resolved), await fs.realpath(command));
        const spawn = utilRequire('cross-spawn');
        const absent = spawn.sync('sourdaw-definitely-missing-fixture', [], {
            cwd: dir,
            env,
        });
        assert.equal(absent.error.code, 'ENOENT');
    }));
test('real temp-file lifecycle waits for creation and cleanup using fs-extra eleven', async () => {
    const { TmpDir } = appRequire('temp-file');
    const manager = new TmpDir('packaging-fixture');
    const dir = await manager.createTempDir({ prefix: 'owned-fixture' });
    const file = await manager.getTempFile({ suffix: '.json' });
    await fs.writeFile(file, '{"fixture":true}');
    assert.equal((await fs.stat(dir)).isDirectory(), true);
    assert.equal(await fs.readFile(file, 'utf8'), '{"fixture":true}');
    await manager.cleanup();
    await assert.rejects(fs.stat(dir), (error) => error.code === 'ENOENT');
    await assert.rejects(fs.stat(file), (error) => error.code === 'ENOENT');
});
test('actual node-gyp thirteen factory and rebuild command queue retain Electron arguments', async () => {
    const rebuildRequire = createRequire(appRequire.resolve('@electron/rebuild'));
    const factory = rebuildRequire('node-gyp');
    const runner = factory();
    runner.parseArgv([
        'node',
        'node-gyp',
        'rebuild',
        '--runtime=electron',
        '--target=45.3.2',
        '--arch=arm64',
        '--dist-url=https://headers.invalid',
    ]);
    assert.equal(runner.opts.runtime, 'electron');
    assert.equal(runner.opts.target, '45.3.2');
    assert.equal(runner.opts.arch, 'arm64');
    const first = runner.todo.shift();
    assert.equal(first.name, 'rebuild');
    await runner.commands.rebuild(first.args);
    assert.deepEqual(
        runner.todo.map((command) => command.name),
        ['clean', 'configure', 'build']
    );
    const bin = path.join(path.dirname(rebuildRequire.resolve('node-gyp/package.json')), 'bin/node-gyp.js');
    const help = spawnSync(process.execPath, [bin, '--help'], {
        encoding: 'utf8',
        timeout: 10000,
        env: process.env,
    });
    assert.equal(help.error, undefined);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: node-gyp/);
});
test('configured non-sandbox ad-hoc entitlements and binary walk retain actual plist and classifier behavior', async () =>
    withDirectory(async (dir) => {
        const osxRoot = path.dirname(appRequire.resolve('@electron/osx-sign'));
        const entitlements = await import(pathToFileURL(path.join(osxRoot, 'util-entitlements.js')).href);
        const signer = appRequire('@electron/osx-sign');
        const file = path.join(dir, 'entitlements.plist');
        const original = await fs.readFile(path.join(__dirname, '../fixtures/entitlements.mac.plist'));
        await fs.writeFile(file, original);
        const options = { entitlements: file };
        await entitlements.preAutoEntitlements({ app: path.join(dir, 'absent.app') }, options, {
            identity: { name: '-' },
        });
        assert.equal(options.entitlements, file);
        assert.deepEqual(await fs.readFile(file), original);
        await assert.rejects(entitlements.ensureAppSandboxEntitlement(file), /app-sandbox/);
        const binary = path.join(dir, 'native.node'),
            text = path.join(dir, 'notice.txt');
        await fs.writeFile(binary, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
        await fs.writeFile(text, 'ordinary UTF-8 notice Ω 音楽');
        const discovered = await signer.walk(dir);
        assert.ok(discovered.includes(binary));
        assert.equal(discovered.includes(text), false);
    }));
test('actual yargs/cliui/wrap-ansi closure observes width nine and ANSI style seven', async () => {
    const ebRequire = createRequire(laneRequire.resolve('electron-builder/package.json'));
    const yargsRequire = createRequire(ebRequire.resolve('yargs'));
    const uiRequire = createRequire(yargsRequire.resolve('cliui'));
    const wrapRequire = createRequire(uiRequire.resolve('wrap-ansi'));
    const { terminalContract } = await import('../fixtures/terminal-contract.mjs');
    terminalContract({
        yargs: ebRequire('yargs'),
        cliui: yargsRequire('cliui'),
        stringWidth: yargsRequire('string-width').default,
        wrapAnsi: uiRequire('wrap-ansi').default,
        ansiStyles: wrapRequire('ansi-styles').default,
    });
});

test('actual get cache consumer retains platform cache path with env-paths four', async () => {
    const getEntry = appRequire.resolve('@electron/get');
    const { Cache } = await import(pathToFileURL(path.join(path.dirname(getEntry), 'Cache.js')).href);
    const actual = new Cache().cacheRoot;
    const expected =
        process.platform === 'darwin'
            ? path.join(os.homedir(), 'Library/Caches/electron')
            : process.platform === 'win32'
              ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'electron/Cache')
              : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'electron');
    assert.equal(actual, expected);
});
