/**
 * Behavioral tests for the inference worker bridge: request/response
 * correlation, worker error propagation, per-request cancellation vs. full
 * worker termination, and the TF.js worker's lazy spawn + idle-destroy timer.
 * Drives a fake Worker double through `onmessage` — the worker THREAD bodies
 * run in a worker environment and are out of scope (see the bridge's doc).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerRequest, type WorkerResponse } from '../../models/InferenceRequest';
import { type ActiveRender } from '../../models/RenderProgress';
import { inferenceProgressStore, startActiveRender } from '../../stores/inferenceProgressStore';
import { inferenceWorkerBridge } from '../inferenceWorkerBridge';

/**
 * A controllable Worker stand-in. Captures posted messages/transfers and
 * lets a test drive the `onmessage` reply channel, so request correlation,
 * cancellation, and idle-destroy timers can be exercised without a real
 * Worker thread.
 */
type FakeWorker = {
    url: string;
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
    postMessage: ReturnType<typeof vi.fn<(message: WorkerRequest, transfer?: Transferable[]) => void>>;
    terminate: ReturnType<typeof vi.fn>;
};

let installedWorkers: FakeWorker[] = [];
const OriginalWorker = globalThis.Worker;

beforeEach(() => {
    installedWorkers = [];
    inferenceProgressStore.set({ activeRenders: {} });

    class WorkerStub {
        url: string;
        onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
        postMessage = vi.fn<(message: WorkerRequest, transfer?: Transferable[]) => void>();
        terminate = vi.fn();
        constructor(url: string | URL) {
            this.url = String(url);
            installedWorkers.push(this);
        }
    }
    globalThis.Worker = WorkerStub as unknown as typeof Worker;
});

afterEach(() => {
    // Reset the bridge's module-level singleton state (worker refs, pending
    // requests, idle timer) so it does not leak between tests.
    inferenceWorkerBridge.terminateAll();
    globalThis.Worker = OriginalWorker;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

function onnxWorker(): FakeWorker {
    const worker = installedWorkers.findLast((w) => w.url.includes('onnxInferenceWorker'));
    if (!worker) {
        throw new Error('no ONNX worker was constructed');
    }
    return worker;
}

function tfjsWorker(): FakeWorker {
    const worker = installedWorkers.findLast((w) => w.url.includes('tfjsInferenceWorker'));
    if (!worker) {
        throw new Error('no TF.js worker was constructed');
    }
    return worker;
}

/** Flush pending microtasks so the bridge's internal `await`s settle before assertions. */
async function flush(): Promise<void> {
    for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
    }
}

function lastCall(worker: FakeWorker): [WorkerRequest, Transferable[]?] {
    const call = worker.postMessage.mock.calls.at(-1);
    if (!call) {
        throw new Error('worker.postMessage was not called');
    }
    return call;
}

function lastRequest(worker: FakeWorker): WorkerRequest {
    return lastCall(worker)[0];
}

function lastRequestId(worker: FakeWorker): string {
    const request = lastRequest(worker);
    if (!('requestId' in request) || !request.requestId) {
        throw new Error('last request has no requestId');
    }
    return request.requestId;
}

function reply(worker: FakeWorker, response: WorkerResponse): void {
    worker.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
}

function ddspRequest(requestId: string): Extract<WorkerRequest, { type: 'run-ddsp-inference' }> {
    return {
        type: 'run-ddsp-inference',
        requestId,
        modelId: 'violin-1',
        pitchHz: new Float32Array([220, 221]),
        loudnessDb: new Float32Array([-20, -19]),
        frameRate: 250,
    };
}

function diffSingerRequest(requestId: string): Extract<WorkerRequest, { type: 'run-diffsinger-phrase' }> {
    return {
        type: 'run-diffsinger-phrase',
        requestId,
        voicebankId: 'voicebank-1',
        tokenIds: [1, 2, 3],
        wordDiv: [1, 1, 1],
        wordDur: [10, 10, 10],
        noteMidi: new Float32Array([60, 62, 64]),
        noteDur: new BigInt64Array([10n, 10n, 10n]),
        durationFrames: 30,
        steps: 5,
        depth: 0.6,
    };
}

describe('inferenceWorkerBridge — ONNX session lifecycle', () => {
    it('spawns one ONNX worker and posts create-session with the model buffer as a transfer', async () => {
        const modelData = new ArrayBuffer(8);
        const promise = inferenceWorkerBridge.loadOnnxSession({ modelId: 'kokoro-82m-q8', modelData });
        await flush();

        expect(installedWorkers).toHaveLength(1);
        const worker = onnxWorker();
        const [request, transfer] = lastCall(worker);
        expect(request).toMatchObject({ type: 'create-session', modelId: 'kokoro-82m-q8', modelData, options: {} });
        expect(transfer).toEqual([modelData]);

        reply(worker, {
            type: 'session-created',
            requestId: lastRequestId(worker),
            modelId: 'kokoro-82m-q8',
            executionProviders: ['wasm'],
        });
        await expect(promise).resolves.toEqual(['wasm']);
    });

    it('reuses the existing ONNX worker for a second session load', async () => {
        const first = inferenceWorkerBridge.loadOnnxSession({ modelId: 'm1', modelData: new ArrayBuffer(4) });
        await flush();
        reply(onnxWorker(), {
            type: 'session-created',
            requestId: lastRequestId(onnxWorker()),
            modelId: 'm1',
            executionProviders: ['webgpu', 'wasm'],
        });
        await first;

        const second = inferenceWorkerBridge.loadOnnxSession({ modelId: 'm2', modelData: new ArrayBuffer(4) });
        await flush();
        expect(installedWorkers).toHaveLength(1);
        reply(onnxWorker(), {
            type: 'session-created',
            requestId: lastRequestId(onnxWorker()),
            modelId: 'm2',
            executionProviders: ['webgpu', 'wasm'],
        });
        await expect(second).resolves.toEqual(['webgpu', 'wasm']);
    });

    it('rejects with the worker error message when the ONNX worker reports an error', async () => {
        const promise = inferenceWorkerBridge.loadOnnxSession({ modelId: 'bad-model', modelData: new ArrayBuffer(4) });
        await flush();
        const worker = onnxWorker();
        reply(worker, { type: 'error', requestId: lastRequestId(worker), error: 'session init failed' });

        await expect(promise).rejects.toThrow('session init failed');
    });

    it.each([
        { executionProviders: [] as Array<'webgpu' | 'wasm'> },
        { executionProviders: ['wasm', 'wasm'] as Array<'webgpu' | 'wasm'> },
    ])('rejects a non-authoritative provider list %#', async ({ executionProviders }) => {
        const promise = inferenceWorkerBridge.loadOnnxSession({
            modelId: 'bad-providers',
            modelData: new ArrayBuffer(4),
        });
        await flush();
        const worker = onnxWorker();
        reply(worker, {
            type: 'session-created',
            requestId: lastRequestId(worker),
            modelId: 'bad-providers',
            executionProviders,
        });

        await expect(promise).rejects.toThrow('Unexpected ONNX session response');
    });

    it('rejects a session response for a different model', async () => {
        const promise = inferenceWorkerBridge.loadOnnxSession({
            modelId: 'expected-model',
            modelData: new ArrayBuffer(4),
        });
        await flush();
        const worker = onnxWorker();
        reply(worker, {
            type: 'session-created',
            requestId: lastRequestId(worker),
            modelId: 'other-model',
            executionProviders: ['webgpu', 'wasm'],
        });

        await expect(promise).rejects.toThrow('Unexpected ONNX session response');
    });
});

describe('inferenceWorkerBridge — getLoadedOnnxSessions', () => {
    it('returns the loadedModels list echoed on the status reply', async () => {
        const promise = inferenceWorkerBridge.getLoadedOnnxSessions();
        await flush();
        const worker = onnxWorker();
        expect(lastRequest(worker)).toMatchObject({ type: 'get-status' });

        reply(worker, {
            type: 'status',
            requestId: lastRequestId(worker),
            loadedModels: ['kokoro-82m-q8', 'diffsinger-1'],
            memoryUsageBytes: 1024,
        });

        await expect(promise).resolves.toEqual(['kokoro-82m-q8', 'diffsinger-1']);
    });
});

describe('inferenceWorkerBridge — DDSP (TF.js) session lifecycle', () => {
    it('spawns a TF.js worker on its own script, not the ONNX worker script', async () => {
        const ddspLoad = inferenceWorkerBridge.loadDdspSession({
            modelId: 'violin-1',
            modelUrl: 'https://cdn.example/violin-1/model.json',
        });
        await flush();

        expect(installedWorkers).toHaveLength(1);
        const tfjs = tfjsWorker();
        expect(tfjs.url).toContain('tfjsInferenceWorker');
        expect(tfjs.url).not.toContain('onnxInferenceWorker');
        expect(lastRequest(tfjs)).toMatchObject({
            type: 'create-session-from-url',
            modelId: 'violin-1',
            modelUrl: 'https://cdn.example/violin-1/model.json',
        });

        reply(tfjs, { type: 'session-created', requestId: lastRequestId(tfjs), modelId: 'violin-1' });
        await expect(ddspLoad).resolves.toBeUndefined();
    });
});

describe('inferenceWorkerBridge — TF.js idle-destroy lifecycle', () => {
    it('terminates the TF.js worker after the idle timeout once no requests are in flight', async () => {
        vi.useFakeTimers();
        const promise = inferenceWorkerBridge.runDdspInference(ddspRequest('req-1'));
        await flush();
        const worker = tfjsWorker();
        reply(worker, { type: 'ddsp-result', requestId: 'req-1', audio: new Float32Array(4), nativeSampleRate: 16000 });
        await promise;

        await vi.advanceTimersByTimeAsync(60_000);

        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it('does not tear down the TF.js worker at the idle deadline while a sibling request is still in flight', async () => {
        vi.useFakeTimers();
        const a = inferenceWorkerBridge.runDdspInference(ddspRequest('a'));
        const b = inferenceWorkerBridge.runDdspInference(ddspRequest('b'));
        await flush();
        const worker = tfjsWorker();

        reply(worker, { type: 'ddsp-result', requestId: 'a', audio: new Float32Array(2), nativeSampleRate: 16000 });
        await a;

        await vi.advanceTimersByTimeAsync(60_000);
        expect(worker.terminate).not.toHaveBeenCalled();

        reply(worker, { type: 'ddsp-result', requestId: 'b', audio: new Float32Array(2), nativeSampleRate: 16000 });
        await expect(b).resolves.toMatchObject({ type: 'ddsp-result', requestId: 'b' });
    });

    it('cancels a pending idle-destroy timer when the TF.js worker is reused before it fires', async () => {
        vi.useFakeTimers();
        const first = inferenceWorkerBridge.runDdspInference(ddspRequest('first'));
        await flush();
        const worker = tfjsWorker();
        reply(worker, { type: 'ddsp-result', requestId: 'first', audio: new Float32Array(2), nativeSampleRate: 16000 });
        await first;
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(30_000); // halfway through the idle window

        const second = inferenceWorkerBridge.runDdspInference(ddspRequest('second'));
        await flush();
        expect(vi.getTimerCount()).toBe(0); // reuse cancelled the pending destroy

        await vi.advanceTimersByTimeAsync(60_000); // well past the original deadline
        expect(worker.terminate).not.toHaveBeenCalled();

        reply(worker, {
            type: 'ddsp-result',
            requestId: 'second',
            audio: new Float32Array(2),
            nativeSampleRate: 16000,
        });
        await expect(second).resolves.toMatchObject({ requestId: 'second' });
    });
});

describe('inferenceWorkerBridge — runKokoroTts', () => {
    it('transfers the inputIds and style buffers and resolves with the correlated tts-result', async () => {
        const inputIds = new BigInt64Array([1n, 2n, 3n]);
        const style = new Float32Array(256);
        const promise = inferenceWorkerBridge.runKokoroTts({ requestId: 'kk-1', inputIds, style, speed: 1 });
        await flush();

        const worker = onnxWorker();
        const [request, transfer] = lastCall(worker);
        expect(request).toMatchObject({ type: 'run-kokoro-tts', requestId: 'kk-1', speed: 1 });
        expect(transfer).toEqual([inputIds.buffer, style.buffer]);

        const audio = new Float32Array([0.1, 0.2]);
        reply(worker, { type: 'tts-result', requestId: 'kk-1', audio, samplingRate: 24000 });

        await expect(promise).resolves.toEqual({ type: 'tts-result', requestId: 'kk-1', audio, samplingRate: 24000 });
    });

    it('rejects when the ONNX worker reports an inference error', async () => {
        const promise = inferenceWorkerBridge.runKokoroTts({
            requestId: 'kk-err',
            inputIds: new BigInt64Array([1n]),
            style: new Float32Array(256),
            speed: 1,
        });
        await flush();
        reply(onnxWorker(), { type: 'error', requestId: 'kk-err', error: 'invalid input length' });

        await expect(promise).rejects.toThrow('invalid input length');
    });
});

describe('inferenceWorkerBridge — runDiffSingerPhrase', () => {
    it('posts the caller-supplied request unmodified and resolves with the correlated result', async () => {
        const promise = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('ds-1'));
        await flush();

        const worker = onnxWorker();
        expect(lastRequest(worker)).toMatchObject({
            type: 'run-diffsinger-phrase',
            requestId: 'ds-1',
            voicebankId: 'voicebank-1',
        });

        const audio = new Float32Array([0.5]);
        reply(worker, { type: 'diffsinger-result', requestId: 'ds-1', audio });
        await expect(promise).resolves.toEqual({ type: 'diffsinger-result', requestId: 'ds-1', audio });
    });
});

describe('inferenceWorkerBridge — releaseOnnxSession / releaseDdspSession', () => {
    it('is a no-op when no ONNX worker has been created yet', async () => {
        await expect(inferenceWorkerBridge.releaseOnnxSession('never-loaded')).resolves.toBeUndefined();
        expect(installedWorkers).toHaveLength(0);
    });

    it('is a no-op when no TF.js worker has been created yet', async () => {
        await expect(inferenceWorkerBridge.releaseDdspSession('never-loaded')).resolves.toBeUndefined();
        expect(installedWorkers).toHaveLength(0);
    });

    it('posts a fire-and-forget release-session message to an existing ONNX worker', async () => {
        const load = inferenceWorkerBridge.loadOnnxSession({ modelId: 'm1', modelData: new ArrayBuffer(4) });
        await flush();
        const worker = onnxWorker();
        reply(worker, {
            type: 'session-created',
            requestId: lastRequestId(worker),
            modelId: 'm1',
            executionProviders: ['webgpu', 'wasm'],
        });
        await load;
        worker.postMessage.mockClear();

        await inferenceWorkerBridge.releaseOnnxSession('m1');

        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'release-session', modelId: 'm1' });
    });

    it('schedules a TF.js idle-destroy when releasing a DDSP session', async () => {
        vi.useFakeTimers();
        const load = inferenceWorkerBridge.loadDdspSession({
            modelId: 'violin-1',
            modelUrl: 'https://cdn.example/violin-1/model.json',
        });
        await flush();
        const worker = tfjsWorker();
        reply(worker, { type: 'session-created', requestId: lastRequestId(worker), modelId: 'violin-1' });
        await load;

        await inferenceWorkerBridge.releaseDdspSession('violin-1');
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'release-session', modelId: 'violin-1' });

        await vi.advanceTimersByTimeAsync(60_000);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});

describe('inferenceWorkerBridge — ONNX cancellation', () => {
    it('rejects only the targeted request and keeps the worker alive for a sibling still in flight', async () => {
        const kept = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('keep'));
        const cancelled = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('cancel-me'));
        await flush();
        const worker = onnxWorker();

        inferenceWorkerBridge.cancelOnnxRequest('cancel-me');

        await expect(cancelled).rejects.toThrow('Render cancelled');
        expect(worker.terminate).not.toHaveBeenCalled();

        reply(worker, { type: 'diffsinger-result', requestId: 'keep', audio: new Float32Array([1]) });
        await expect(kept).resolves.toMatchObject({ requestId: 'keep' });
    });

    it('terminates the ONNX worker when cancelling the last in-flight request, and respawns on next use', async () => {
        const promise = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('only'));
        await flush();
        const worker = onnxWorker();

        inferenceWorkerBridge.cancelOnnxRequest('only');

        await expect(promise).rejects.toThrow('Render cancelled');
        expect(worker.terminate).toHaveBeenCalledTimes(1);

        // The next call must spawn a fresh worker — the old one is dead. Left
        // pending on purpose; afterEach's terminateAll() will reject it.
        const respawned = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('after-restart'));
        respawned.catch(() => undefined);
        await flush();
        expect(installedWorkers).toHaveLength(2);
    });

    it('is a no-op for a requestId that is not pending', () => {
        expect(() => inferenceWorkerBridge.cancelOnnxRequest('never-existed')).not.toThrow();
        expect(installedWorkers).toHaveLength(0);
    });
});

describe('inferenceWorkerBridge — terminateOnnxWorker', () => {
    it('rejects every pending ONNX request and terminates the worker', async () => {
        const a = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('a'));
        const b = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('b'));
        await flush();
        const worker = onnxWorker();

        inferenceWorkerBridge.terminateOnnxWorker();

        await expect(a).rejects.toThrow('Render cancelled');
        await expect(b).rejects.toThrow('Render cancelled');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});

describe('inferenceWorkerBridge — TF.js cancellation', () => {
    it('clears a pending idle-destroy timer when cancelling the last in-flight DDSP request', async () => {
        vi.useFakeTimers();
        const a = inferenceWorkerBridge.runDdspInference(ddspRequest('a'));
        const b = inferenceWorkerBridge.runDdspInference(ddspRequest('b'));
        await flush();
        const worker = tfjsWorker();

        // 'a' finishes first — with 'b' still pending, this arms the idle-destroy
        // timer (it arms unconditionally; the pending-count check happens on fire).
        reply(worker, { type: 'ddsp-result', requestId: 'a', audio: new Float32Array(2), nativeSampleRate: 16000 });
        await a;
        expect(vi.getTimerCount()).toBe(1);

        inferenceWorkerBridge.cancelTfjsRequest('b');
        await expect(b).rejects.toThrow('Render cancelled');

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('terminates the TF.js worker and rejects all pending requests', async () => {
        const a = inferenceWorkerBridge.runDdspInference(ddspRequest('a'));
        const b = inferenceWorkerBridge.runDdspInference(ddspRequest('b'));
        await flush();
        const worker = tfjsWorker();

        inferenceWorkerBridge.terminateTfjsWorker();

        await expect(a).rejects.toThrow('Render cancelled');
        await expect(b).rejects.toThrow('Render cancelled');
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
});

describe('inferenceWorkerBridge — terminateAll', () => {
    it('terminates both workers and rejects every pending request across them', async () => {
        const onnxPending = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('ds'));
        const ddspPending = inferenceWorkerBridge.runDdspInference(ddspRequest('dd'));
        await flush();
        const onnx = onnxWorker();
        const tfjs = tfjsWorker();

        inferenceWorkerBridge.terminateAll();

        await expect(onnxPending).rejects.toThrow('Render cancelled');
        await expect(ddspPending).rejects.toThrow('Render cancelled');
        expect(onnx.terminate).toHaveBeenCalledTimes(1);
        expect(tfjs.terminate).toHaveBeenCalledTimes(1);
    });
});

describe('inferenceWorkerBridge — worker message routing', () => {
    it('routes inference-progress events into the progress store without resolving the pending request', async () => {
        const render: ActiveRender = {
            requestId: 'ds-progress',
            phraseId: 'phrase-1',
            pipeline: 'diffsinger',
            status: 'rendering-browser',
            stage: 'starting',
            progress: 0,
            startedAt: Date.now(),
        };
        startActiveRender(render);

        const promise = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('ds-progress'));
        await flush();
        const worker = onnxWorker();

        reply(worker, { type: 'inference-progress', requestId: 'ds-progress', stage: 'diffusing', progress: 0.5 });

        expect(inferenceProgressStore.value?.activeRenders['ds-progress']).toMatchObject({
            stage: 'diffusing',
            progress: 0.5,
        });

        let settled = false;
        void promise.then(() => {
            settled = true;
            return undefined;
        });
        await flush();
        expect(settled).toBe(false);

        reply(worker, { type: 'diffsinger-result', requestId: 'ds-progress', audio: new Float32Array([1]) });
        await expect(promise).resolves.toMatchObject({ requestId: 'ds-progress' });
    });

    it('silently drops a response for a requestId that is no longer pending', async () => {
        const promise = inferenceWorkerBridge.runDiffSingerPhrase(diffSingerRequest('late'));
        await flush();
        const worker = onnxWorker();

        inferenceWorkerBridge.cancelOnnxRequest('late'); // removes from pendingRequests, terminates the sole worker
        await expect(promise).rejects.toThrow('Render cancelled');

        expect(() =>
            reply(worker, { type: 'diffsinger-result', requestId: 'late', audio: new Float32Array([1]) })
        ).not.toThrow();
    });
});
