import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crumbsStore, ensureInstance, setActiveSample, setMode } from '../../stores/crumbsStore';
import { prepareCrumbsEngine } from '../prepareCrumbsEngine';

import type { SampleMeta } from '../../models/CrumbsTypes';

const { decodeMock, warnMock } = vi.hoisted(() => ({
    decodeMock: vi.fn(),
    warnMock: vi.fn(),
}));

vi.mock('../../repositories/sampleTransfer/decodeCrumbsSampleFile', () => ({
    decodeCrumbsSampleFile: decodeMock,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: warnMock, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const DEVICE = 'crumbs-device-1';

function sampleMeta(filePath: string): SampleMeta {
    return {
        sampleId: 0,
        sampleRate: 48_000,
        channels: 2,
        frameCount: 4,
        durationSecs: 4 / 48_000,
        detectedRoot: null,
        detectedBpm: null,
        category: 'unknown',
        filePath,
        fileName: 'break.wav',
    };
}

/** A port that records what was posted, standing in for the worklet's. */
function recordingPort(): {
    port: MessagePort;
    posts: Array<{ message: Record<string, unknown>; transfer?: unknown }>;
} {
    const posts: Array<{ message: Record<string, unknown>; transfer?: unknown }> = [];
    const port = {
        postMessage: (message: Record<string, unknown>, transfer?: unknown) => {
            posts.push({ message, transfer });
        },
    } as unknown as MessagePort;
    return { port, posts };
}

function messagesOfType(
    posts: Array<{ message: Record<string, unknown> }>,
    type: string
): Array<Record<string, unknown>> {
    return posts.map((post) => post.message).filter((message) => message.type === type);
}

describe('prepareCrumbsEngine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crumbsStore.set({});
    });

    afterEach(() => {
        crumbsStore.set({});
    });

    it('sends the decoded sample to the worklet with the channel count and rate it was decoded at', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const data = new Float32Array([0.1, -0.1, 0.2, -0.2]);
        decodeMock.mockResolvedValue({ data, frameCount: 2, channels: 2, sampleRate: 44_100 });
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE, port });

        expect(decodeMock).toHaveBeenCalledWith({ filePath: '/samples/break.wav' });
        const [load] = messagesOfType(posts, 'loadSample');
        expect(load).toEqual({ type: 'loadSample', data, channels: 2, sampleRate: 44_100 });
    });

    it('transfers the PCM buffer rather than copying it', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const data = new Float32Array([0.5, 0.25]);
        decodeMock.mockResolvedValue({ data, frameCount: 2, channels: 1, sampleRate: 48_000 });
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE, port });

        const loadPost = posts.find((post) => post.message.type === 'loadSample');
        expect(loadPost?.transfer).toEqual([data.buffer]);
    });

    it('sends the device mode the project holds, not the engine default', async () => {
        ensureInstance(DEVICE);
        setMode(DEVICE, 'slice');
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE, port });

        expect(messagesOfType(posts, 'mode')).toEqual([{ type: 'mode', mode: 'slice' }]);
    });

    it('loads nothing for a device with no sample selected, rather than failing', async () => {
        ensureInstance(DEVICE);
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE, port });

        expect(decodeMock).not.toHaveBeenCalled();
        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
    });

    it('posts nothing at all for a device the store does not know', async () => {
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: 'never-created', port });

        expect(posts).toEqual([]);
    });

    // Throwing here would abort the caller's device setup, and `buildDeviceChain`
    // reads a missing entry as "this track has no instrument" — which substitutes
    // the fallback synth. A silent Crumbs is recoverable; a sawtooth is not.
    it('reports a failed decode and leaves the engine unloaded instead of throwing', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/missing.wav'));
        decodeMock.mockRejectedValue(new Error('ENOENT'));
        const { port, posts } = recordingPort();

        await expect(prepareCrumbsEngine({ deviceId: DEVICE, port })).resolves.toBeUndefined();

        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
        expect(String(warnMock.mock.calls[0]?.[0])).toContain('/samples/missing.wav');
    });

    it('drops a sample that finished decoding after the export was cancelled', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const controller = new AbortController();
        decodeMock.mockImplementation(() => {
            controller.abort();
            return Promise.resolve({
                data: new Float32Array([1]),
                frameCount: 1,
                channels: 1,
                sampleRate: 48_000,
            });
        });
        const { port, posts } = recordingPort();

        await prepareCrumbsEngine({ deviceId: DEVICE, port, signal: controller.signal });

        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
    });
});
