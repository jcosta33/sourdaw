import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * tfjsInferenceWorker is a stub that always reports DDSP rendering as
 * unavailable (TF.js cannot be bundled by Rolldown). Importing the module
 * registers `self.onmessage` as a side effect. We spy on `self.postMessage`
 * and dispatch synthetic MessageEvents to exercise each request branch.
 */

// Side-effect import: evaluates the module so `self.onmessage` is registered.
import '../tfjsInferenceWorker';

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

    it('silently no-ops on release-session', () => {
        const req: WorkerRequest = { type: 'release-session', modelId: 'm1' };
        dispatch(req);

        expect(postMessageSpy).not.toHaveBeenCalled();
    });

    it('returns an unavailable error for create-session-from-url requests (DDSP)', () => {
        const req: WorkerRequest = {
            type: 'create-session-from-url',
            requestId: 'r3',
            modelId: 'ddsp-1',
            modelUrl: 'https://example.test/ddsp/model.json',
        };
        dispatch(req);

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response.type).toBe('error');
        expect(response.requestId).toBe('r3');
        if (response.type === 'error') {
            expect(response.error).toContain('unavailable');
        }
    });

    it('returns an unavailable error for run-ddsp-inference requests', () => {
        const req: WorkerRequest = {
            type: 'run-ddsp-inference',
            requestId: 'r4',
            modelId: 'ddsp-1',
            pitchHz: new Float32Array([440]),
            loudnessDb: new Float32Array([-10]),
            frameRate: 250,
        };
        dispatch(req);

        expect(postMessageSpy).toHaveBeenCalledTimes(1);
        const response = postMessageSpy.mock.calls[0]![0] as WorkerResponse;
        expect(response.type).toBe('error');
        expect(response.requestId).toBe('r4');
        if (response.type === 'error') {
            expect(response.error).toContain('unavailable');
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
            expect(response.error).toContain('unavailable');
        }
    });
});
