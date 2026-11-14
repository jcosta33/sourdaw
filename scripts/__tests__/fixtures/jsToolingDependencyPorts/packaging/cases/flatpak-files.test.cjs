'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRequire } = require('node:module');
assert.ok(process.env.PACKAGING_REQUIRE_FROM);
const laneRequire = require('../fixtures/installed-require.cjs').packageRequire;
const appRequire = createRequire(laneRequire.resolve('app-builder-lib/package.json'));
test('actual flatpak file preparation retains JSON, copied bytes, export and symlink outputs', async (context) => {
    const commands = [];
    const originalExec = cp.exec;
    const exec = (command, callback) => {
        commands.push(command);
        callback(null, 'flatpak-builder 1.14.0\n', '');
    };
    exec[require('node:util').promisify.custom] = async (command) => {
        commands.push(command);
        return { stdout: 'flatpak-builder 1.14.0\n', stderr: '' };
    };
    cp.exec = exec;
    context.after(() => {
        cp.exec = originalExec;
    });
    context.mock.method(cp, 'spawn', (command, args, options) => {
        commands.push({ command, args, cwd: options.cwd });
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => child.emit('close', 0));
        return child;
    });
    const flatpak = appRequire('@malept/flatpak-bundler');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-flatpak-'));
    try {
        const source = path.join(dir, 'input');
        await fs.writeFile(source, 'fixture Ω bytes');
        const manifest = {
            id: 'com.sourdaw.fixture',
            runtime: 'org.freedesktop.Platform',
            sdk: 'org.freedesktop.Sdk',
            runtimeVersion: '24.08',
            command: 'fixture',
            modules: [],
        };
        const options = await flatpak.bundle(manifest, {
            workingDir: path.join(dir, 'working'),
            arch: 'x64',
            files: [[source, 'bin/fixture']],
            symlinks: [['bin/fixture', 'bin/alias']],
            extraExports: ['bin/fixture'],
            autoInstallRuntime: false,
            autoInstallSdk: false,
            autoInstallBase: false,
        });
        const stored = JSON.parse(await fs.readFile(options['manifest-path'], 'utf8'));
        assert.equal(stored['runtime-version'], '24.08');
        assert.equal(options.arch, 'x86_64');
        assert.equal(
            await fs.readFile(path.join(options['build-dir'], 'files/bin/fixture'), 'utf8'),
            'fixture Ω bytes'
        );
        assert.equal(await fs.readlink(path.join(options['build-dir'], 'files/bin/alias')), '/app/bin/fixture');
        assert.equal(
            await fs.readFile(path.join(options['build-dir'], 'export/bin/fixture'), 'utf8'),
            'fixture Ω bytes'
        );
        assert.ok(
            commands.some(
                (item) => item.command === 'flatpak-builder' && item.args[item.args.indexOf('--arch') + 1] === 'x86_64'
            )
        );
        await assert.rejects(
            flatpak.bundle(manifest, {
                workingDir: path.join(dir, 'failure'),
                files: [[path.join(dir, 'missing'), 'bin/missing']],
                autoInstallRuntime: false,
                autoInstallSdk: false,
                autoInstallBase: false,
            }),
            (error) => error.code === 'ENOENT'
        );
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
