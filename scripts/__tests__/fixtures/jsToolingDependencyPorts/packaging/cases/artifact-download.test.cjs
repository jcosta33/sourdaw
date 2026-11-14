'use strict';
const { test } = require('node:test');
const { packageRequire } = require('../fixtures/installed-require.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { downloadElectronArtifactZip } = packageRequire('app-builder-lib/out/util/electronGet');
const { withArtifactDownloadOptions } = packageRequire('app-builder-lib/out/util/artifactDownloadOptions');
function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
async function withDirectory(run) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaging-fetch-'));
    try {
        return await run(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}
const body = Buffer.from('not an executable: exact streaming artifact bytes Ω');
const filename = 'electron-v45.3.2-darwin-arm64.zip';
function artifactOptions(cacheDir, downloadOptions = {}) {
    return {
        artifactName: 'electron',
        version: '45.3.2',
        platformName: 'darwin',
        arch: 'arm64',
        cacheDir,
        electronDownload: {
            mirrorOptions: {
                resolveAssetURL: async () => 'https://fixture.invalid/known-artifact.zip',
            },
            checksums: {
                [filename]: createHash('sha256').update(body).digest('hex'),
            },
            downloadOptions,
        },
    };
}
test('real get five and app downloader write verified bytes, forward headers and honor cache', async (context) =>
    withDirectory(async (dir) => {
        let calls = 0;
        context.mock.method(globalThis, 'fetch', async (url, options) => {
            calls++;
            assert.equal(String(url), 'https://fixture.invalid/known-artifact.zip');
            assert.deepEqual(options.headers, { 'x-fixture': 'literal-header' });
            assert.equal('agent' in options, false);
            assert.equal('timeout' in options, false);
            assert.equal('https' in options, false);
            assert.ok(options.signal instanceof AbortSignal);
            assert.ok(options.dispatcher);
            return new Response(body, {
                headers: { 'content-length': String(body.length) },
            });
        });
        const options = artifactOptions(dir, {
            headers: { 'x-fixture': 'literal-header' },
        });
        const first = await downloadElectronArtifactZip(options);
        assert.deepEqual(await fs.readFile(first), body);
        const cached = await downloadElectronArtifactZip(options);
        assert.deepEqual(await fs.readFile(cached), body);
        assert.equal(calls, 1);
    }));
test('real fetch HTTP errors retry server failures and reject 404 without retry', { timeout: 20000 }, async (context) =>
    withDirectory(async (dir) => {
        let calls = 0;
        context.mock.method(globalThis, 'fetch', async () => {
            calls++;
            return calls === 1 ? new Response('server unavailable', { status: 503 }) : new Response(body);
        });
        assert.deepEqual(
            await fs.readFile(await downloadElectronArtifactZip(artifactOptions(path.join(dir, 'server')))),
            body
        );
        assert.equal(calls, 2, 'response.status must enter the parent retry route');
        context.mock.restoreAll();
        calls = 0;
        context.mock.method(globalThis, 'fetch', async () => {
            calls++;
            return new Response('missing', { status: 404 });
        });
        await assert.rejects(downloadElectronArtifactZip(artifactOptions(path.join(dir, 'missing'))), /404/);
        assert.equal(calls, 1, 'client errors must not be retried');
    })
);
test('real artifact checksum mismatch rejects changed streaming bytes', async (context) =>
    withDirectory(async (dir) => {
        context.mock.method(globalThis, 'fetch', async () => new Response(Buffer.from('tampered bytes')));
        await assert.rejects(downloadElectronArtifactZip(artifactOptions(dir)), /checksum|does not match|mismatch/i);
    }));
test('external abort propagates through the real Fetch stream and is not retried', async (context) =>
    withDirectory(async (dir) => {
        const controller = new AbortController();
        const started = deferred();
        let calls = 0;
        context.mock.method(globalThis, 'fetch', async (url, options) => {
            calls++;
            return new Response(
                new ReadableStream({
                    start(stream) {
                        stream.enqueue(new Uint8Array([1, 2, 3]));
                        options.signal.addEventListener('abort', () => stream.error(options.signal.reason), {
                            once: true,
                        });
                        started.resolve();
                    },
                })
            );
        });
        const operation = downloadElectronArtifactZip(artifactOptions(dir, { signal: controller.signal }));
        const rejected = assert.rejects(operation, (error) => error.name === 'AbortError');
        await started.promise;
        controller.abort();
        await rejected;
        assert.equal(calls, 1);
    }));
test('removed Got options cannot be silently passed to Fetch', async () => {
    await assert.rejects(
        withArtifactDownloadOptions({ agent: {} }, async () => assert.fail('unsupported agent reached downloader')),
        /dispatcher/
    );
    await assert.rejects(
        withArtifactDownloadOptions({ retry: { limit: 9 } }, async () =>
            assert.fail('unsupported retry reached downloader')
        ),
        /Unsupported Fetch/
    );
    await assert.rejects(
        withArtifactDownloadOptions({ timeout: { connect: 100 } }, async () =>
            assert.fail('unsupported timeout reached downloader')
        ),
        /timeout.request/
    );
});

test('artifact and nested checksum receive separate full request deadlines', async (context) =>
    withDirectory(async (dir) => {
        const deadlineDurations = [];
        const signals = [];
        context.mock.method(AbortSignal, 'timeout', (duration) => {
            deadlineDurations.push(duration);
            return new AbortController().signal;
        });
        context.mock.method(globalThis, 'fetch', async (url, options) => {
            signals.push(options.signal);
            return String(url).includes('SHASUMS256')
                ? new Response(createHash('sha256').update(body).digest('hex') + ' *' + filename + '\n')
                : new Response(body);
        });
        const options = artifactOptions(dir);
        delete options.electronDownload.checksums;
        options.electronDownload.mirrorOptions.resolveAssetURL = async (details) =>
            'https://fixture.invalid/' + details.artifactName;
        assert.deepEqual(await fs.readFile(await downloadElectronArtifactZip(options)), body);
        assert.deepEqual(deadlineDurations, [600000, 600000]);
        assert.equal(signals.length, 2);
        assert.notEqual(
            signals[0],
            signals[1],
            'a checksum must receive a fresh deadline, not an almost-expired artifact signal'
        );
    }));
