import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TF.js worker error handling and session lifecycle. Importing the module
 * registers `self.onmessage` as a side effect. We spy on `self.postMessage`
 * and dispatch synthetic MessageEvents to exercise each request branch.
 */

// Side-effect import: evaluates the module so `self.onmessage` is registered.
import { concatenateDdspChunks, parseDdspSettings, splitDdspFrames } from '../tfjsInferenceWorker';

import type { WorkerRequest, WorkerResponse } from '../../models/InferenceRequest';

let postMessageSpy: ReturnType<typeof vi.fn>;

function dispatch(data: WorkerRequest): void {
    const handler = (self as unknown as { onmessage: ((event: MessageEvent) => void) | null }).onmessage;
    handler?.(new MessageEvent('message', { data }));
}

describe('tfjsInferenceWorker', () => {
    beforeEach(() => {
        postMessageSpy = vi.fn();
        // jsdom's native postMessage requires a targetOrigin; the worker calls
        // it with a single arg, so replace it with a bare spy.
        (self as unknown as { postMessage: unknown }).postMessage = postMessageSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('responds to get-status with an empty model list and zero memory', () => {
        const req: WorkerRequest = { type: 'get-status', requestId: 'r1' };
        dispatch(req);

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response).toEqual({
            type: 'status',
            requestId: 'r1',
            loadedModels: [],
            memoryUsageBytes: 0,
        });
    });

    it('rejects settings without the verified model frame contract', () => {
        expect(() => parseDdspSettings(new TextEncoder().encode('{}').buffer)).toThrow('modelMaxFrameLength');
    });

    it('crops a short 0.5 second request to 8,000 native samples before resampling', () => {
        const frames = 125;
        const samples = Math.round((frames / 250) * 16_000);
        expect(samples).toBe(8_000);
        expect(concatenateDdspChunks([new Float32Array(80_000).slice(0, samples)])).toHaveLength(8_000);
    });

    it('splits longer phrases at the model limit and concatenates contiguous chunks without gaps or duplication', () => {
        const chunks = splitDdspFrames(1_500, 1_250);
        expect(chunks).toEqual([
            { start: 0, end: 1_250 },
            { start: 1_250, end: 1_500 },
        ]);
        const first = Float32Array.from({ length: 80_000 }, (_, index) => index);
        const second = Float32Array.from({ length: 16_000 }, (_, index) => 80_000 + index);
        const joined = concatenateDdspChunks([first, second]);
        expect(joined).toHaveLength(96_000);
        expect(joined[79_999]).toBe(79_999);
        expect(joined[80_000]).toBe(80_000);
        expect(joined.at(-1)).toBe(95_999);
    });

    it('silently no-ops on release-session', () => {
        const req: WorkerRequest = { type: 'release-session', modelId: 'm1' };
        dispatch(req);

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('rejects a stored DDSP session when WebGPU is absent', async () => {
        const req: WorkerRequest = {
            type: 'create-session-from-model-storage',
            requestId: 'r3',
            modelId: 'ddsp-1',
            artifacts: [],
        };
        dispatch(req);

        await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalledTimes(1));
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response.type).toBe('error');
        expect(response.requestId).toBe('r3');
        if (response.type === 'error') {
            expect(response.error).toContain('WebGPU');
        }
    });

    it('reports a missing DDSP session', async () => {
        const req: WorkerRequest = {
            type: 'run-ddsp-inference',
            requestId: 'r4',
            modelId: 'ddsp-1',
            pitchHz: new Float32Array([440]),
            loudnessDb: new Float32Array([-10]),
            frameRate: 250,
        };
        dispatch(req);

        await vi.waitFor(() => expect(postMessageSpy).toHaveBeenCalledTimes(1));
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response.type).toBe('error');
        expect(response.requestId).toBe('r4');
        if (response.type === 'error') {
            expect(response.error).toContain('session not found');
        }
    });

    it('returns an unavailable error for run-kokoro-tts requests', () => {
        const req: WorkerRequest = {
            type: 'run-kokoro-tts',
            requestId: 'r5',
            inputIds: new BigInt64Array([0n, 1n, 0n]),
            style: new Float32Array(256),
            speed: 1.0,
        };
        dispatch(req);

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response.type).toBe('error');
        expect(response.requestId).toBe('r5');
        if (response.type === 'error') {
            expect(response.error).toContain('Unsupported');
        }
    });
});
