const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const app = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const squirrel = createRequire(app.resolve('electron-builder-squirrel-windows/package.json'));
const installer = createRequire(squirrel.resolve('electron-winstaller'));
const windowsEntry = installer.resolve('@electron/windows-sign');
const windowsRoot = path.dirname(path.dirname(windowsEntry));
const windows = createRequire(windowsEntry);
const postjectRoot = path.dirname(windows.resolve('postject/package.json'));
const cli = path.join(postjectRoot, 'dist/cli.js');
function run(file, args) {
    const child = cp.spawnSync(process.execPath, [file, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        env: process.env,
    });
    assert.equal(child.error, undefined);
    return child;
}
test('actual latest signing ESM public names and argument builder preserve values without signing', async (context) => {
    const sign = installer('@electron/windows-sign');
    assert.equal(typeof sign.sign, 'function');
    assert.equal(typeof sign.createSeaSignTool, 'function');
    const { getSigntoolArgs, parseSignWithParams } = await import(
        pathToFileURL(path.join(windowsRoot, 'dist/sign-with-signtool.js')).href
    );
    assert.deepEqual(parseSignWithParams('/d "Sourdaw Ω & 音楽" /tr "https://timestamp.invalid/path"'), [
        '/d',
        'Sourdaw Ω & 音楽',
        '/tr',
        'https://timestamp.invalid/path',
    ]);
    const args = getSigntoolArgs({
        hash: 'sha256',
        timestampServer: 'https://default.invalid',
        description: 'Sourdaw Ω',
        signWithParams: ['/tr', 'https://custom.invalid', '/fd', 'sha384'],
        automaticallySelectCertificate: false,
    });
    assert.equal(args.filter((x) => x === '/tr').length, 1);
    assert.equal(args.filter((x) => x === '/fd').length, 1);
    assert.ok(args.includes('https://custom.invalid'));
    assert.ok(args.includes('sha384'));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sign-values-'));
    try {
        for (const name of ['spawn', 'exec', 'execFile'])
            context.mock.method(cp, name, () => assert.fail('native signing boundary reached'));
        const file = path.join(dir, 'uncreated', 'tool.exe');
        await assert.rejects(sign.createSeaSignTool({ path: file }), /windowsSign options/);
        await assert.rejects(fs.stat(path.dirname(file)), (e) => e.code === 'ENOENT');
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
test('actual postject binary help and refusal use latest commander without native injection', () => {
    const help = run(cli, ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage: postject/);
    assert.match(help.stdout, /--sentinel-fuse/);
    const unknown = run(cli, ['--definitely-invalid-fixture-flag']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown option/);
});
test('actual postject latest parser forwards literal positionals flags and real resource bytes at injection boundary', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'postject-values-'));
    try {
        const resource = path.join(dir, 'resource.bin');
        await fs.writeFile(resource, Buffer.from([7, 2, 9, 0]));
        const file = path.join(dir, 'dummy non executable');
        const result = run(path.join(__dirname, '../fixtures/postject-cli-worker.cjs'), [
            cli,
            JSON.stringify([
                file,
                'FIXTURE_RESOURCE',
                resource,
                '--sentinel-fuse',
                'INERT_SENTINEL',
                '--macho-segment-name',
                '__FIXTURE',
                '--overwrite',
            ]),
        ]);
        assert.equal(result.status, 0, result.stderr);
        const line = result.stdout.split('\n').find((x) => x.startsWith('POSTJECT_ARGS:'));
        assert.ok(line, result.stdout);
        assert.deepEqual(JSON.parse(line.slice('POSTJECT_ARGS:'.length)), {
            file,
            name: 'FIXTURE_RESOURCE',
            bytes: [7, 2, 9, 0],
            options: {
                machoSegmentName: '__FIXTURE',
                overwrite: true,
                sentinelFuse: 'INERT_SENTINEL',
            },
        });
        await assert.rejects(fs.stat(file), (e) => e.code === 'ENOENT');
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});
