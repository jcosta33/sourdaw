/**
 * Measures BrowserAi's model cold-read boundary in installed stable Chrome.
 *
 * The fixture is exactly 86 MiB and is written to the production OPFS layout in
 * 1 MiB chunks, so setup never creates the allocation under test. The legacy
 * leg directly reproduces the former renderer File.arrayBuffer() read. The
 * worker leg transfers the production repository's MessagePort straight to a
 * hashing worker, so the renderer never receives the model ArrayBuffer. Both
 * legs run one warmup and five handle-reopening reads and verify exact SHA-256.
 * Continuous CDP sampling spans each complete read-and-hash lifecycle. A
 * transient 86 MiB renderer control is transferred and detached before its
 * operation returns; the run is invalid unless that control breaches the gate.
 *
 * Usage:
 *   pnpm browser-ai:model-storage -- --mode legacy
 *   pnpm browser-ai:model-storage -- --mode worker --baseline-ms 38.7
 */

import { createHash } from 'node:crypto';
import { cpus, loadavg, platform, release } from 'node:os';

import { chromium, type CDPSession, type Page } from 'playwright';
import { createServer, type Plugin } from 'vite';

import { launchRenderDeadlineBrowser } from './renderDeadlineBrowser.ts';

const FIXTURE_BYTES = 86 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const MEASURED_READS = 5;
const MODELS_DIRECTORY = 'models';
const FAMILY = 'measurement';
const MODEL_ID = 'browser-ai-86m-fixture.onnx';
const PROBE_PATH = '/browser-ai-model-storage-probe.html';
const EXIT_NOT_MEASURED = 2;
const MAX_RENDERER_MODEL_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_COLD_READ_REGRESSION = 1.1;

type Mode = 'legacy' | 'worker';

type HeapUsage = {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize: number;
    backingStorageSize: number;
};

type ReadSample = {
    durationMs: number;
    rendererBackingStorageDeltaBytes: number;
    rendererUsedHeapDeltaBytes: number;
    measuredMemoryBytes: number | null;
    hash: string;
};

function parseMode(): Mode {
    const modeIndex = process.argv.indexOf('--mode');
    const mode = modeIndex === -1 ? 'legacy' : process.argv[modeIndex + 1];
    if (mode !== 'legacy' && mode !== 'worker') {
        throw new Error(`Unsupported mode ${String(mode)}; expected legacy or worker`);
    }
    return mode;
}

function parseBaselineMs(mode: Mode): number | null {
    const baselineIndex = process.argv.indexOf('--baseline-ms');
    if (baselineIndex === -1) {
        if (mode === 'worker') {
            throw new Error('Worker mode requires --baseline-ms from the same 86 MiB legacy protocol');
        }
        return null;
    }
    const baselineMs = Number(process.argv[baselineIndex + 1]);
    if (!Number.isFinite(baselineMs) || baselineMs <= 0) {
        throw new Error(`Invalid --baseline-ms value: ${String(process.argv[baselineIndex + 1])}`);
    }
    return baselineMs;
}

function makeChunk(offset: number, length: number): Uint8Array {
    const chunk = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        chunk[index] = ((offset + index) * 31 + 17) & 0xff;
    }
    return chunk;
}

function expectedFixtureHash(): string {
    const hash = createHash('sha256');
    for (let offset = 0; offset < FIXTURE_BYTES; offset += CHUNK_BYTES) {
        hash.update(makeChunk(offset, Math.min(CHUNK_BYTES, FIXTURE_BYTES - offset)));
    }
    return hash.digest('hex');
}

function percentile50(values: readonly number[]): number {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const SINK_WORKER_SOURCE = `
self.onmessage = (event) => {
    const { id, port } = event.data;
    port.onmessage = async (messageEvent) => {
        port.close();
        try {
            const message = messageEvent.data;
            if (!message || message.type !== 'model-data' || !(message.modelData instanceof ArrayBuffer)) {
                throw new Error(message?.message ?? 'Storage worker returned no model bytes');
            }
            const digest = await crypto.subtle.digest('SHA-256', message.modelData);
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
            self.postMessage({ id, hash });
        } catch (error) {
            self.postMessage({ id, error: String(error) });
        }
    };
    port.onmessageerror = () => {
        port.close();
        self.postMessage({ id, error: 'Unreadable model data' });
    };
    port.start();
};
`;

function probePlugin(mode: Mode): Plugin {
    return {
        name: 'browser-ai-model-storage-probe',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                if (request.url !== PROBE_PATH) {
                    next();
                    return;
                }
                response.statusCode = 200;
                response.setHeader('Content-Type', 'text/html; charset=utf-8');
                response.end(`<!doctype html>
<meta charset="utf-8">
<script type="module">
import { readModel } from '/src/modules/BrowserAi/repositories/readModel.ts';
import { modelStorageWorkerBridge } from '/src/modules/BrowserAi/repositories/modelStorageWorkerBridge.ts';

const FIXTURE_BYTES = ${String(FIXTURE_BYTES)};
const CHUNK_BYTES = ${String(CHUNK_BYTES)};
const MODELS_DIRECTORY = ${JSON.stringify(MODELS_DIRECTORY)};
const FAMILY = ${JSON.stringify(FAMILY)};
const MODEL_ID = ${JSON.stringify(MODEL_ID)};
const MODE = ${JSON.stringify(mode)};
let heldBuffer = null;
let heldHashPromise = null;
let nextSinkId = 0;
const sinkPending = new Map();
const sinkUrl = URL.createObjectURL(new Blob([${JSON.stringify(SINK_WORKER_SOURCE)}], { type: 'text/javascript' }));
const sinkWorker = new Worker(sinkUrl);
const releaseUrl = URL.createObjectURL(new Blob([
    'self.onmessage = event => self.postMessage(event.data.byteLength);'
], { type: 'text/javascript' }));
const releaseWorker = new Worker(releaseUrl);

sinkWorker.onmessage = (event) => {
    const pending = sinkPending.get(event.data.id);
    if (!pending) {
        return;
    }
    sinkPending.delete(event.data.id);
    if (event.data.error) {
        pending.reject(new Error(event.data.error));
    } else {
        pending.resolve(event.data.hash);
    }
};

function makeChunk(offset, length) {
    const chunk = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
        chunk[index] = ((offset + index) * 31 + 17) & 0xff;
    }
    return chunk;
}

async function seed() {
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: true });
    const family = await models.getDirectoryHandle(FAMILY, { create: true });
    const file = await family.getFileHandle(MODEL_ID, { create: true });
    const writable = await file.createWritable();
    for (let offset = 0; offset < FIXTURE_BYTES; offset += CHUNK_BYTES) {
        await writable.write(makeChunk(offset, Math.min(CHUNK_BYTES, FIXTURE_BYTES - offset)));
    }
    await writable.close();
}

async function readLegacy() {
    const startedAt = performance.now();
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false });
    const family = await models.getDirectoryHandle(FAMILY, { create: false });
    const file = await family.getFileHandle(MODEL_ID, { create: false });
    heldBuffer = await (await file.getFile()).arrayBuffer();
    if (!(heldBuffer instanceof ArrayBuffer) || heldBuffer.byteLength !== FIXTURE_BYTES) {
        throw new Error('Legacy read did not return the complete 86 MiB model buffer');
    }
    return performance.now() - startedAt;
}

async function readWorker() {
    const startedAt = performance.now();
    const modelDataPort = await readModel({ family: FAMILY, modelId: MODEL_ID });
    if (!(modelDataPort instanceof MessagePort)) {
        throw new Error('Worker read did not return a model transfer port');
    }
    const id = nextSinkId;
    nextSinkId += 1;
    heldHashPromise = new Promise((resolve, reject) => {
        sinkPending.set(id, { resolve, reject });
    });
    sinkWorker.postMessage({ id, port: modelDataPort }, [modelDataPort]);
    return performance.now() - startedAt;
}

async function allocateTransientRendererFixture() {
    const modelBuffer = new ArrayBuffer(FIXTURE_BYTES);
    new Uint8Array(modelBuffer).fill(0x5a);
    await new Promise(resolve => setTimeout(resolve, 25));
    const releasedBytes = new Promise((resolve, reject) => {
        releaseWorker.onmessage = event => resolve(event.data);
        releaseWorker.onerror = event => reject(new Error(event.message || 'Allocation release worker failed'));
    });
    releaseWorker.postMessage(modelBuffer, [modelBuffer]);
    if (modelBuffer.byteLength !== 0) {
        throw new Error('Renderer allocation control did not detach its model buffer');
    }
    return releasedBytes;
}

async function hashHeldBuffer() {
    if (MODE === 'worker') {
        if (!heldHashPromise) {
            throw new Error('No worker model hash is pending');
        }
        return heldHashPromise;
    }
    if (!(heldBuffer instanceof ArrayBuffer)) {
        throw new Error('No model buffer is held');
    }
    const digest = await crypto.subtle.digest('SHA-256', heldBuffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function measuredMemoryBytes() {
    if (typeof performance.measureUserAgentSpecificMemory !== 'function') {
        return null;
    }
    const measurement = await performance.measureUserAgentSpecificMemory();
    return measurement.bytes;
}

function releaseBuffer() {
    heldBuffer = null;
    heldHashPromise = null;
}

async function cleanup() {
    releaseBuffer();
    modelStorageWorkerBridge.terminate();
    sinkWorker.terminate();
    releaseWorker.terminate();
    URL.revokeObjectURL(sinkUrl);
    URL.revokeObjectURL(releaseUrl);
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false });
    const family = await models.getDirectoryHandle(FAMILY, { create: false });
    await family.removeEntry(MODEL_ID).catch(() => undefined);
}

globalThis.browserAiModelStorageProbe = {
    seed,
    allocateTransientRendererFixture,
    readLegacy,
    readWorker,
    hashHeldBuffer,
    measuredMemoryBytes,
    releaseBuffer,
    cleanup,
};
</script>`);
            });
        },
    };
}

async function collectGarbage(cdp: CDPSession): Promise<void> {
    await cdp.send('HeapProfiler.collectGarbage');
}

async function getHeapUsage(cdp: CDPSession): Promise<HeapUsage> {
    const usage = await cdp.send('Runtime.getHeapUsage');
    return {
        usedSize: usage.usedSize,
        totalSize: usage.totalSize,
        embedderHeapUsedSize: usage.embedderHeapUsedSize,
        backingStorageSize: usage.backingStorageSize,
    };
}

async function observeRendererBackingStorageHighWater<TResult>(
    cdp: CDPSession,
    operation: () => Promise<TResult>
): Promise<{ before: HeapUsage; after: HeapUsage; peakBackingStorageSize: number; result: TResult }> {
    const before = await getHeapUsage(cdp);
    let peakBackingStorageSize = before.backingStorageSize;
    let observing = true;
    const sampler = (async () => {
        while (observing) {
            const sample = await getHeapUsage(cdp);
            peakBackingStorageSize = Math.max(peakBackingStorageSize, sample.backingStorageSize);
        }
    })();
    let result: TResult;
    try {
        result = await operation();
    } finally {
        observing = false;
        await sampler;
    }
    const after = await getHeapUsage(cdp);
    peakBackingStorageSize = Math.max(peakBackingStorageSize, after.backingStorageSize);
    return { before, after, peakBackingStorageSize, result };
}

async function evaluateProbe<TResult>(page: Page, method: string): Promise<TResult> {
    return page.evaluate(async (methodName) => {
        const probe = (
            globalThis as typeof globalThis & {
                browserAiModelStorageProbe?: Record<string, () => unknown>;
            }
        ).browserAiModelStorageProbe;
        const operation = probe?.[methodName];
        if (!operation) {
            throw new Error(`Probe method unavailable: ${methodName}`);
        }
        return operation();
    }, method) as Promise<TResult>;
}

async function measureRead(page: Page, cdp: CDPSession, mode: Mode): Promise<ReadSample> {
    await collectGarbage(cdp);
    const observation = await observeRendererBackingStorageHighWater(cdp, async () => {
        const durationMs = await evaluateProbe<number>(page, mode === 'legacy' ? 'readLegacy' : 'readWorker');
        const hash = await evaluateProbe<string>(page, 'hashHeldBuffer');
        return { durationMs, hash };
    });
    const measuredMemoryBytes = await evaluateProbe<number | null>(page, 'measuredMemoryBytes');
    await evaluateProbe<void>(page, 'releaseBuffer');
    return {
        durationMs: observation.result.durationMs,
        rendererBackingStorageDeltaBytes: observation.peakBackingStorageSize - observation.before.backingStorageSize,
        rendererUsedHeapDeltaBytes: observation.after.usedSize - observation.before.usedSize,
        measuredMemoryBytes,
        hash: observation.result.hash,
    };
}

async function measureRendererAllocationControl(page: Page, cdp: CDPSession): Promise<number> {
    await collectGarbage(cdp);
    const observation = await observeRendererBackingStorageHighWater(cdp, () =>
        evaluateProbe<number>(page, 'allocateTransientRendererFixture')
    );
    if (observation.result !== FIXTURE_BYTES) {
        throw new Error(
            `Renderer allocation control transferred ${String(observation.result)} of ${String(FIXTURE_BYTES)} bytes`
        );
    }
    return Math.max(0, observation.peakBackingStorageSize - observation.before.backingStorageSize);
}

const mode = parseMode();
const baselineMs = parseBaselineMs(mode);
const expectedHash = expectedFixtureHash();
const vite = await createServer({
    plugins: [probePlugin(mode)],
    server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
        },
    },
    logLevel: 'error',
});

await vite.listen();
const address = vite.httpServer?.address();
if (address === null || typeof address === 'string' || address === undefined) {
    await vite.close();
    throw new Error('Measurement server did not bind to a TCP port');
}

const launched = await launchRenderDeadlineBrowser({
    headed: process.argv.includes('--headed'),
    launchBrowser: (options) => chromium.launch(options),
});
if (launched.status === 'not-measured') {
    console.error(`NOT MEASURED: ${String(launched.error)}`);
    await vite.close();
    process.exit(EXIT_NOT_MEASURED);
}

const browser = launched.browser;
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
try {
    await page.goto(`http://127.0.0.1:${String(address.port)}${PROBE_PATH}`);
    await page.waitForFunction(() => 'browserAiModelStorageProbe' in globalThis);
    await evaluateProbe<void>(page, 'seed');

    const rendererAllocationControlBytes = await measureRendererAllocationControl(page, cdp);
    if (rendererAllocationControlBytes <= MAX_RENDERER_MODEL_BUFFER_BYTES) {
        throw new Error(
            `Renderer allocation control was not rejected: observed ${String(rendererAllocationControlBytes)} bytes for the ${String(FIXTURE_BYTES)}-byte fixture`
        );
    }

    const warmup = await measureRead(page, cdp, mode);
    if (warmup.hash !== expectedHash) {
        throw new Error(`Warmup byte drift: expected ${expectedHash}, got ${warmup.hash}`);
    }

    const samples: ReadSample[] = [];
    for (let index = 0; index < MEASURED_READS; index += 1) {
        const sample = await measureRead(page, cdp, mode);
        if (sample.hash !== expectedHash) {
            throw new Error(`Read ${String(index + 1)} byte drift: expected ${expectedHash}, got ${sample.hash}`);
        }
        samples.push(sample);
    }

    const browserVersion = browser.version();
    const durations = samples.map((sample) => sample.durationMs);
    const medianColdReadMs = percentile50(durations);
    const peakRendererAllocation = Math.max(0, ...samples.map((sample) => sample.rendererBackingStorageDeltaBytes));
    const acceptance =
        mode === 'worker' && baselineMs !== null
            ? {
                  maxRendererModelBufferBytes: MAX_RENDERER_MODEL_BUFFER_BYTES,
                  maxMedianColdReadMs: baselineMs * MAX_COLD_READ_REGRESSION,
                  rendererAllocationPassed: peakRendererAllocation <= MAX_RENDERER_MODEL_BUFFER_BYTES,
                  coldReadPassed: medianColdReadMs <= baselineMs * MAX_COLD_READ_REGRESSION,
              }
            : null;
    const result = {
        mode,
        browserVersion,
        machine: {
            platform: `${platform()} ${release()}`,
            cpu: cpus()[0]?.model ?? 'unknown',
            logicalCpus: cpus().length,
            loadAverage: loadavg(),
        },
        protocol: {
            fixtureBytes: FIXTURE_BYTES,
            fixtureSha256: expectedHash,
            warmups: 1,
            measuredReads: MEASURED_READS,
        },
        medianColdReadMs,
        peakRendererModelBufferBytes: peakRendererAllocation,
        rendererAllocationPassed: peakRendererAllocation <= MAX_RENDERER_MODEL_BUFFER_BYTES,
        rendererAllocationControl: {
            allocatedBytes: FIXTURE_BYTES,
            observedPeakRendererBytes: rendererAllocationControlBytes,
            rejectedByRendererAllocationGate: rendererAllocationControlBytes > MAX_RENDERER_MODEL_BUFFER_BYTES,
        },
        acceptance,
        samples,
    };
    console.log(JSON.stringify(result, null, 2));
    if (acceptance && (!acceptance.rendererAllocationPassed || !acceptance.coldReadPassed)) {
        throw new Error(
            `Worker model-storage acceptance failed: renderer=${String(peakRendererAllocation)} bytes, median=${String(medianColdReadMs)} ms`
        );
    }
} finally {
    await evaluateProbe<void>(page, 'cleanup').catch(() => undefined);
    await browser.close();
    await vite.close();
}
