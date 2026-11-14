'use strict';
const { test } = require('node:test');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const assert = require('node:assert/strict');
const { createYargs, configureBuildCommand, normalizeOptions } = packageRequire('electron-builder/out/builder');
const { configureInstallAppDepsCommand } = packageRequire('electron-builder/out/cli/install-app-deps');
const { configurePublishCommand } = packageRequire('electron-builder/out/publish');
const { Platform } = packageRequire('app-builder-lib');
const { Arch } = packageRequire('builder-util');
test('actual builder CLI keeps multi-target flags, aliases, architecture and config coercion', () => {
    const parsed = configureBuildCommand(createYargs())
        .exitProcess(false)
        .parse([
            '--mac',
            'dmg',
            'zip',
            '--arm64',
            '--publish',
            'never',
            '-c.nsis.oneClick=false',
            '-c.extraMetadata.version=7',
        ]);
    const options = normalizeOptions(parsed);
    assert.deepEqual(options.targets.get(Platform.MAC).get(Arch.arm64), ['dmg', 'zip']);
    assert.equal(options.publish, 'never');
    assert.equal(options.config.nsis.oneClick, false);
    assert.equal(options.config.extraMetadata.version, '7');
    const win = normalizeOptions(
        configureBuildCommand(createYargs()).exitProcess(false).parse(['--windows', 'nsis', '--x64'])
    );
    assert.deepEqual(win.targets.get(Platform.WINDOWS).get(Arch.x64), ['nsis']);
    const linux = normalizeOptions(
        configureBuildCommand(createYargs()).exitProcess(false).parse(['-l', 'AppImage', '--x64'])
    );
    assert.deepEqual(linux.targets.get(Platform.LINUX).get(Arch.x64), ['AppImage']);
});
test('actual subcommand parsers preserve platform choices and rejected publish values', () => {
    const deps = configureInstallAppDepsCommand(createYargs())
        .exitProcess(false)
        .parse(['--platform', 'win32', '--arch', 'x64']);
    assert.equal(deps.platform, 'win32');
    assert.equal(deps.arch, 'x64');
    assert.throws(() =>
        configureInstallAppDepsCommand(createYargs()).exitProcess(false).parse(['--platform', 'not-a-platform'])
    );
    assert.throws(() =>
        configurePublishCommand(createYargs()).exitProcess(false).parse(['--publish', 'invalid-policy'])
    );
});
