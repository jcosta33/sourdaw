const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const native = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createRequire } = require('node:module');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const app = createRequire(packageRequire.resolve('app-builder-lib/package.json'));
const squirrel = createRequire(app.resolve('electron-builder-squirrel-windows/package.json'));
const installerFile = squirrel.resolve('electron-winstaller');
const installer = createRequire(installerFile);
const temp = installer('temp');
async function dir(run) {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'squirrel-values-'));
    try {
        await run(d);
    } finally {
        await fs.rm(d, { recursive: true, force: true });
    }
}
test('actual temp latest mkdirp/rimraf preserves Promise callback sync modes cleanup counts and failures', () =>
    dir(async (d) => {
        temp.track();
        const one = await temp.mkdir({ dir: d, prefix: 'one-' });
        const two = await new Promise((resolve, reject) =>
            temp.mkdir({ dir: d, prefix: 'two-' }, (error, value) => (error ? reject(error) : resolve(value)))
        );
        const three = temp.mkdirSync({ dir: d, prefix: 'three-' });
        for (const p of [one, two, three]) assert.equal((await fs.stat(p)).mode & 0o777, 0o700);
        const f = await temp.open({ dir: d, prefix: 'file-' });
        native.closeSync(f.fd);
        await fs.writeFile(f.path, 'owned bytes');
        const sync = temp.openSync({ dir: d, prefix: 'sync-' });
        native.closeSync(sync.fd);
        const counts = await temp.cleanup();
        assert.deepEqual(counts, { files: 2, dirs: 3 });
        for (const p of [one, two, three, f.path, sync.path])
            await assert.rejects(fs.stat(p), (e) => e.code === 'ENOENT');
        assert.deepEqual(
            await new Promise((resolve, reject) =>
                temp.cleanup((error, value) => (error ? reject(error) : resolve(value)))
            ),
            { files: 0, dirs: 0 }
        );
        const again = temp.mkdirSync({ dir: d, prefix: 'sync-cleanup-' });
        const againFile = temp.openSync({ dir: d, prefix: 'sync-cleanup-' });
        native.closeSync(againFile.fd);
        assert.deepEqual(temp.cleanupSync(), { files: 1, dirs: 1 });
        await assert.rejects(fs.stat(again), (e) => e.code === 'ENOENT');
        const notDir = path.join(d, 'file');
        await fs.writeFile(notDir, 'x');
        await assert.rejects(temp.mkdir({ dir: notDir }), (e) => e.code === 'ENOTDIR');
        assert.throws(
            () => temp.mkdirSync({ dir: notDir }),
            (e) => e.code === 'ENOTDIR'
        );
        temp.track(false);
        await assert.rejects(temp.cleanup(), /not tracking/);
        temp.track();
    }));
test('actual temp tracked process exit removes its owned file and directory', () => {
    const child = cp.spawnSync(
        process.execPath,
        [path.join(__dirname, '../fixtures/temp-exit-worker.cjs'), installerFile],
        { encoding: 'utf8', timeout: 5000, env: process.env }
    );
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    const { dir, file } = JSON.parse(child.stdout);
    assert.equal(native.existsSync(dir), false);
    assert.equal(native.existsSync(file), false);
});
test(
    'Squirrel latest installer consumes real ASAR metadata filesystem copy and NuSpec temp bytes before native command boundary',
    { timeout: 10000 },
    (context) =>
        dir(async (d) => {
            const calls = [],
                boundaryError = new Error('controlled native NuGet boundary');
            context.mock.method(cp, 'exec', (command, callback) => {
                calls.push(command);
                callback(null, 'available', '');
            });
            context.mock.method(cp, 'spawn', (command, args) => {
                calls.push({ command, args });
                throw boundaryError;
            });
            const api = squirrel('electron-winstaller');
            assert.equal(api.convertVersion('1.2.3-beta.4+build.9'), '1.2.3-beta4');
            assert.equal(api.sanitizeAuthors('fixture@example.com'), 'fixtureexample.com');
            const source = path.join(d, 'source'),
                appDir = path.join(d, 'app'),
                vendor = path.join(d, 'vendor');
            await fs.mkdir(source);
            await fs.mkdir(path.join(appDir, 'resources'), { recursive: true });
            await fs.mkdir(vendor);
            await fs.writeFile(path.join(vendor, 'Squirrel.exe'), 'dummy non-executable fixture bytes');
            await fs.writeFile(
                path.join(source, 'package.json'),
                JSON.stringify({
                    name: 'sourdaw-fixture',
                    productName: 'Sourdaw Ω & 音楽',
                    version: '1.2.3-beta.4+build.9',
                    author: 'fixture@example.com',
                    description: 'Known & fixed description',
                })
            );
            await installer('@electron/asar').createPackage(source, path.join(appDir, 'resources/app.asar'));
            await assert.rejects(
                api.createWindowsInstaller({
                    appDirectory: appDir,
                    outputDirectory: path.join(d, 'out'),
                    vendorDirectory: vendor,
                    skipUpdateIcon: true,
                }),
                (e) => e === boundaryError
            );
            assert.equal(
                await fs.readFile(path.join(appDir, 'Squirrel.exe'), 'utf8'),
                'dummy non-executable fixture bytes'
            );
            const launched = calls.find((c) => typeof c === 'object');
            assert.ok(launched);
            const nuspec = launched.args[launched.args.indexOf('pack') + 1];
            assert.ok(nuspec.endsWith('/sourdaw-fixture.nuspec'));
            const xml = await fs.readFile(nuspec, 'utf8');
            assert.match(xml, /<title>Sourdaw Ω &amp; 音楽<\/title>/);
            assert.match(xml, /<version>1\.2\.3-beta4<\/version>/);
            assert.match(xml, /<authors>fixtureexample\.com<\/authors>/);
            assert.match(xml, /<owners>fixture@example\.com<\/owners>/);
            assert.match(xml, /Known &amp; fixed description/);
            assert.ok(launched.args.includes('-NoDefaultExcludes'));
            await temp.cleanup();
        })
);
