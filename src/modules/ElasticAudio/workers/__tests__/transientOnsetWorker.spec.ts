import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectTransients } from '../../models/TransientDetection';
import { type TransientOnsetWorkerRequest } from '../../models/TransientOnsetWorker';

vi.mock('../../models/TransientDetection', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../models/TransientDetection')>();
    return { ...original, detectTransients: vi.fn(original.detectTransients) };
});

const endpoint: {
    onmessage: ((event: MessageEvent<TransientOnsetWorkerRequest>) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
} = { onmessage: null, postMessage: vi.fn() };

describe('transient worker entry', () => {
    beforeAll(async () => {
        vi.stubGlobal('self', endpoint);
        await import('../transientOnsetWorker');
    });
    beforeEach(() => vi.clearAllMocks());
    afterAll(() => vi.unstubAllGlobals());

    it('downmixes all copied channels and invokes the unchanged whole-source detector exactly once', () => {
        const left = new Float32Array(32_768);
        left[8_192] = 1;
        left[24_576] = 1;
        const right = new Float32Array(32_768);
        const expected = left.map((sample) => sample / 2);
        endpoint.onmessage?.(
            new MessageEvent('message', { data: { channels: [left, right], sampleRate: 16_000, sensitivity: 0.5 } })
        );
        expect(detectTransients).toHaveBeenCalledExactlyOnceWith(expected, 16_000, 0.5);
        const result: unknown = endpoint.postMessage.mock.calls[0]?.[0];
        expect(result).toMatchObject({
            status: 'complete',
            hits: expect.arrayContaining([{ sampleOffset: expect.any(Number), confidence: expect.any(Number) }]),
        });
        expect(left[8_192]).toBe(1);
        expect(right[8_192]).toBe(0);
    });

    it('refuses invalid PCM without invoking the detector or returning sample data', () => {
        const samples = new Float32Array(4_096);
        samples[512] = NaN;
        endpoint.onmessage?.(
            new MessageEvent('message', { data: { channels: [samples], sampleRate: 16_000, sensitivity: 0.5 } })
        );
        expect(detectTransients).not.toHaveBeenCalled();
        expect(endpoint.postMessage).toHaveBeenCalledExactlyOnceWith({ status: 'failed', code: 'analysis-failed' });
    });
});
