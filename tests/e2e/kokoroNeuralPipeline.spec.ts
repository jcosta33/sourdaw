import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';

import { type BrowserContext, type Page, type TestInfo } from '@playwright/test';

import { expect, test } from './e2eTest';

const BASE =
    'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const MODEL_ID = 'kokoro-82m-q8-1939ad2a';
const PHRASE_ID = 'kokoro-real-owner';
const artifacts = [
    {
        name: 'model_q8f16.onnx',
        url: `${BASE}/onnx/model_q8f16.onnx`,
        size: 86_033_585,
        sha256: '04c658aec1b6008857c2ad10f8c589d4180d0ec427e7e6118ceb487e215c3cd0',
    },
    {
        name: 'af_heart.bin',
        url: `${BASE}/voices/af_heart.bin`,
        size: 522_240,
        sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
    },
] as const;

type Artifact = (typeof artifacts)[number];
type Snapshot = {
    queue: {
        entries: { phraseId: string; requestId: string; pipeline: string; status: string; queuedAt: number }[];
        cachedPhraseIds: string[];
        phraseStatusMap: Record<string, string>;
        phraseRequestIds: Record<string, string>;
    };
    progress: { activeRenders: Record<string, unknown> };
};
type AudioProof = {
    sampleRate: number;
    length: number;
    finite: boolean;
    peak: number;
    rms: number;
    variance: number;
    first: number;
    last: number;
    sha256: string;
    provenance: { modelId: string; voiceId: string; renderQuality: string; tier: string; renderedAt: number };
};
type KokoroProbe = {
    prepare: () => Promise<{
        admitted: boolean;
        verified: boolean;
        providers: string[];
        inputIds: number[];
        tokenCount: number;
        warnings: string[];
    }>;
    startOld: () => void;
    settleOld: () => Promise<{ status: string; message?: string }>;
    renderCurrent: () => Promise<AudioProof>;
    state: () => Snapshot;
    cacheWitness: (text: string) => Promise<{ cacheKey: string; length: number | null; sha256: string | null }>;
    cleanup: () => void;
};

async function fetchBounded(artifact: Artifact): Promise<Uint8Array> {
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(60_000), credentials: 'omit' });
    if (!response.ok || !response.body) {
        throw new Error(`Pinned Kokoro artifact HTTP ${String(response.status)}: ${artifact.url}`);
    }
    const bytes = new Uint8Array(artifact.size);
    let offset = 0;
    for await (const chunk of response.body) {
        if (offset + chunk.length > bytes.length) {
            throw new Error(`Pinned Kokoro artifact exceeds ${String(artifact.size)} bytes: ${artifact.name}`);
        }
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    expect(offset, artifact.name).toBe(artifact.size);
    return bytes;
}

async function acquireArtifact(artifact: Artifact, testInfo: TestInfo): Promise<string> {
    const fixtureDirectory = process.env.SOURDAW_KOKORO_FIXTURE_DIR;
    let bytes: Uint8Array;
    if (fixtureDirectory !== undefined) {
        const source = join(fixtureDirectory, artifact.name);
        expect((await stat(source)).size, source).toBe(artifact.size);
        bytes = await readFile(source);
    } else {
        bytes = await fetchBounded(artifact);
    }
    expect(bytes.byteLength, artifact.name).toBe(artifact.size);
    expect(createHash('sha256').update(bytes).digest('hex'), artifact.name).toBe(artifact.sha256);
    const output = testInfo.outputPath('kokoro-fixtures', artifact.name);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: 'wx' });
    return output;
}

async function startFixtureServer(files: Map<string, string>) {
    const errors: string[] = [];
    const server = createServer((request, response) => {
        const path = files.get(request.url ?? '');
        if (request.method !== 'GET' || !path) {
            errors.push(`Unexpected fixture request: ${request.method ?? ''} ${request.url ?? ''}`);
            response.writeHead(404).end();
            return;
        }
        void stat(path).then(
            (file) => {
                response.writeHead(200, {
                    'content-length': file.size,
                    'content-type': 'application/octet-stream',
                    'access-control-allow-origin': '*',
                    'cross-origin-resource-policy': 'cross-origin',
                });
                const stream = createReadStream(path);
                stream.on('error', (error) => {
                    errors.push(error.message);
                    response.destroy(error);
                });
                stream.pipe(response);
            },
            (error: unknown) => {
                errors.push(String(error));
                response.destroy(error instanceof Error ? error : new Error(String(error)));
            }
        );
    });
    server.on('error', (error) => errors.push(error.message));
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Fixture server did not bind an actual loopback TCP port');
    }
    return {
        origin: `http://127.0.0.1:${String(address.port)}`,
        errors,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.closeAllConnections();
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            }),
    };
}

async function routeArtifacts(context: BrowserContext, testInfo: TestInfo, origin: string) {
    const paths = new Map<string, string>();
    const fixtureFiles = new Map<string, string>();
    for (const artifact of artifacts) {
        const path = `/kokoro/${artifact.name}`;
        fixtureFiles.set(path, await acquireArtifact(artifact, testInfo));
        paths.set(artifact.url, path);
    }
    await testInfo.attach('verified-pinned-fixtures', {
        body: JSON.stringify(artifacts),
        contentType: 'application/json',
    });
    const entered = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    const server = await startFixtureServer(fixtureFiles);
    let voiceRequests = 0;
    const unexpected: string[] = [];
    await context.route('**/*', async (route) => {
        const url = route.request().url();
        const path = paths.get(url);
        if (path) {
            if (url === `${BASE}/voices/af_heart.bin` && ++voiceRequests === 1) {
                entered.resolve();
                await held.promise;
            }
            await route.fulfill({
                status: 307,
                headers: {
                    location: `${server.origin}${path}`,
                    'access-control-allow-origin': '*',
                    'cross-origin-resource-policy': 'cross-origin',
                },
            });
            return;
        }
        if (new URL(url).origin === origin) {
            await route.continue();
            return;
        }
        const fixtureUrl = new URL(url);
        if (fixtureUrl.origin === server.origin && fixtureFiles.has(fixtureUrl.pathname) && !fixtureUrl.search) {
            await route.continue();
            return;
        }
        unexpected.push(url);
        await route.abort('blockedbyclient');
    });
    return { entered: entered.promise, release: () => held.resolve(), unexpected, server };
}

async function cleanupProbe(page: Page, close: () => Promise<void>, testInfo: TestInfo, succeeded: boolean) {
    async function cleanupPage(): Promise<void> {
        if (!page.isClosed()) {
            await page.evaluate(() =>
                (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe | undefined)?.cleanup()
            );
        }
    }
    const results = await Promise.allSettled([cleanupPage(), close()]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
        await testInfo.attach('cleanup-errors', {
            body: failures.map((failure) => String(failure.reason)).join('\n'),
            contentType: 'text/plain',
        });
        if (succeeded) {
            throw new Error('Kokoro fixture cleanup failed; see cleanup-errors attachment');
        }
    }
}

function assertAudio(proof: AudioProof): void {
    expect(proof.sampleRate).toBe(44_100);
    expect(Math.abs(proof.length - 55_125)).toBeLessThanOrEqual(221);
    expect(proof.finite).toBe(true);
    expect(proof.peak).toBeGreaterThan(1e-5);
    expect(proof.peak).toBeLessThan(4);
    expect(proof.rms).toBeGreaterThan(1e-6);
    expect(proof.variance).toBeGreaterThan(1e-10);
    expect(Math.abs(proof.first)).toBe(0);
    expect(Math.abs(proof.last)).toBe(0);
    expect(proof.provenance).toEqual({
        modelId: MODEL_ID,
        voiceId: 'af_heart',
        renderQuality: 'standard',
        tier: 'browser-preview',
        renderedAt: expect.any(Number),
    });
}

function observeRuntime(page: Page, context: BrowserContext) {
    const diagnostics: string[] = [];
    const runtimeResponses: { url: string; status: number; coep: string | undefined }[] = [];
    page.on('console', (message) => diagnostics.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`));
    page.on('crash', () => diagnostics.push('page: crash'));
    page.on('close', () => diagnostics.push('page: close'));
    page.on('requestfailed', (request) =>
        diagnostics.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`)
    );
    context.browser()?.on('disconnected', () => diagnostics.push('browser: disconnected'));
    context.on('response', (response) => {
        const url = response.url();
        if (url.includes('/onnxruntime-web.js?') || url.endsWith('.wasm')) {
            runtimeResponses.push({
                url,
                status: response.status(),
                coep: response.headers()['cross-origin-embedder-policy'],
            });
        }
    });
    return { diagnostics, runtimeResponses };
}

test('real Kokoro model renders bounded PCM and superseded preparation cannot publish', async ({
    page,
    context,
    baseURL,
}, testInfo) => {
    test.setTimeout(180_000);
    if (!baseURL) {
        throw new Error('The owning Kokoro probe requires the lane dev-server origin');
    }
    const transport = await routeArtifacts(context, testInfo, new URL(baseURL).origin);
    const { diagnostics, runtimeResponses } = observeRuntime(page, context);
    let succeeded = false;
    try {
        await page.goto('/tests/e2e/kokoroRenderProbe.html');
        await page.waitForFunction(() => Reflect.has(window, '__SOURDAW_KOKORO_RENDER_PROBE__'));
        const prepared = await page.evaluate(() =>
            (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).prepare()
        );
        await testInfo.attach('actual-session-and-fixtures', {
            body: JSON.stringify({ prepared, artifacts }),
            contentType: 'application/json',
        });
        expect(prepared.admitted).toBe(true);
        expect(prepared.verified).toBe(true);
        expect(prepared.providers.length).toBeGreaterThan(0);
        expect(prepared.providers.every((provider) => provider === 'wasm' || provider === 'webgpu')).toBe(true);
        expect(prepared.inputIds).toEqual([0, 50, 138, 54, 57, 135, 16, 65, 85, 54, 46, 0]);
        expect(prepared.tokenCount).toBe(10);
        expect(prepared.warnings).toEqual([]);
        const empty = await page.evaluate(async () => {
            const probe = Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe;
            return { old: await probe.cacheWitness('sun moon'), current: await probe.cacheWitness('hello world') };
        });
        expect(empty.old.sha256).toBeNull();
        expect(empty.current.sha256).toBeNull();
        await page.evaluate(() => (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).startOld());
        await transport.entered;
        const pending = await page.evaluate(() =>
            (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).state()
        );
        expect(pending.queue.entries).toHaveLength(1);
        expect(pending.queue.entries[0]).toMatchObject({
            phraseId: PHRASE_ID,
            pipeline: 'kokoro',
            status: 'rendering-browser',
        });
        expect(pending.queue.cachedPhraseIds).toEqual([]);
        expect(pending.progress.activeRenders).toEqual({});
        const proof = await page.evaluate(() =>
            (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).renderCurrent()
        );
        await testInfo.attach('actual-pcm', { body: JSON.stringify(proof), contentType: 'application/json' });
        assertAudio(proof);
        const completed = await page.evaluate(() =>
            (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).state()
        );
        expect(completed.queue.entries).toEqual([]);
        expect(completed.progress.activeRenders).toEqual({});
        expect(completed.queue.phraseStatusMap).toEqual({ [PHRASE_ID]: 'preview' });
        expect(completed.queue.phraseRequestIds[PHRASE_ID]).toEqual(expect.any(String));
        expect(completed.queue.phraseRequestIds[PHRASE_ID]).not.toBe(pending.queue.phraseRequestIds[PHRASE_ID]);
        transport.release();
        const old = await page.evaluate(() =>
            (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).settleOld()
        );
        expect(old).toEqual({ status: 'rejected', message: 'Kokoro render was cancelled or superseded' });
        expect(
            await page.evaluate(() => (Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe).state())
        ).toEqual(completed);
        const caches = await page.evaluate(async () => {
            const probe = Reflect.get(window, '__SOURDAW_KOKORO_RENDER_PROBE__') as KokoroProbe;
            return { old: await probe.cacheWitness('sun moon'), current: await probe.cacheWitness('hello world') };
        });
        expect(caches.old.sha256).toBeNull();
        expect(caches.current).toMatchObject({ sha256: proof.sha256, length: proof.length });
        expect(completed.queue.cachedPhraseIds).toEqual([caches.current.cacheKey]);
        expect(transport.unexpected).toEqual([]);
        expect(transport.server.errors).toEqual([]);
        expect(runtimeResponses.length).toBeGreaterThan(0);
        expect(runtimeResponses.every((response) => response.status === 200)).toBe(true);
        succeeded = true;
    } finally {
        transport.release();
        await testInfo.attach('runtime-diagnostics', {
            body: [...diagnostics, ...transport.server.errors.map((error) => `fixture server: ${error}`)].join('\n'),
            contentType: 'text/plain',
        });
        await testInfo.attach('actual-runtime-responses', {
            body: JSON.stringify(runtimeResponses),
            contentType: 'application/json',
        });
        await cleanupProbe(page, transport.server.close, testInfo, succeeded);
    }
});
