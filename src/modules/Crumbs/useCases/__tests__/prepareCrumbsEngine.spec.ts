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
function recordingPort(options?: { loadPostError?: Error }): {
    port: MessagePort;
    posts: Array<{ message: Record<string, unknown>; transfer?: unknown }>;
    emit: (message: Record<string, unknown>) => void;
    listenerCount: () => number;
} {
    const posts: Array<{ message: Record<string, unknown>; transfer?: unknown }> = [];
    const listeners = new Set<(event: MessageEvent<unknown>) => void>();
    const port = {
        postMessage: (message: Record<string, unknown>, transfer?: unknown) => {
            if (message.type === 'loadSample' && options?.loadPostError) {
                throw options.loadPostError;
            }
            posts.push({ message, transfer });
        },
        addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
            if (type === 'message') {
                listeners.add(listener);
            }
        },
        removeEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) => {
            if (type === 'message') {
                listeners.delete(listener);
            }
        },
    } as unknown as MessagePort;
    return {
        port,
        posts,
        emit: (message) => {
            for (const listener of listeners) {
                listener({ data: message } as MessageEvent<unknown>);
            }
        },
        listenerCount: () => listeners.size,
    };
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

    it('settles ready only after the worklet commits the decoded sample', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const data = new Float32Array([0.1, -0.1, 0.2, -0.2]);
        decodeMock.mockResolvedValue({ data, frameCount: 2, channels: 2, sampleRate: 44_100 });
        const { port, posts, emit, listenerCount } = recordingPort();

        let settled = false;
        const preparation = prepareCrumbsEngine({ deviceId: DEVICE, port }).then((outcome) => {
            settled = true;
            return outcome;
        });
        await vi.waitFor(() => expect(messagesOfType(posts, 'loadSample')).toHaveLength(1));

        expect(decodeMock).toHaveBeenCalledWith({ filePath: '/samples/break.wav' });
        expect(settled).toBe(false);
        const [load] = messagesOfType(posts, 'loadSample');
        expect(load).toMatchObject({ type: 'loadSample', data, channels: 2, sampleRate: 44_100 });
        const loadToken = load?.loadToken;
        if (typeof loadToken !== 'number') {
            throw new TypeError('sample load did not include a numeric token');
        }
        emit({ type: 'sampleLoaded', loadToken: loadToken + 1 });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(listenerCount()).toBe(1);

        emit({ type: 'sampleLoaded', loadToken });
        await expect(preparation).resolves.toBe('ready');
        expect(listenerCount()).toBe(0);
    });

    it('transfers the PCM buffer rather than copying it', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const data = new Float32Array([0.5, 0.25]);
        decodeMock.mockResolvedValue({ data, frameCount: 2, channels: 1, sampleRate: 48_000 });
        const { port, posts, emit } = recordingPort();

        const preparation = prepareCrumbsEngine({ deviceId: DEVICE, port });
        await vi.waitFor(() => expect(messagesOfType(posts, 'loadSample')).toHaveLength(1));

        const loadPost = posts.find((post) => post.message.type === 'loadSample');
        expect(loadPost?.transfer).toEqual([data.buffer]);
        const loadToken = loadPost?.message.loadToken;
        if (typeof loadToken !== 'number') {
            throw new TypeError('sample load did not include a numeric token');
        }
        emit({ type: 'sampleLoaded', loadToken });
        await expect(preparation).resolves.toBe('ready');
    });

    it('reports a worklet sample-commit failure without throwing', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        decodeMock.mockResolvedValue({
            data: new Float32Array([0.5]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        const { port, posts, emit, listenerCount } = recordingPort();

        const preparation = prepareCrumbsEngine({ deviceId: DEVICE, port });
        await vi.waitFor(() => expect(messagesOfType(posts, 'loadSample')).toHaveLength(1));
        const loadToken = messagesOfType(posts, 'loadSample')[0]?.loadToken;
        if (typeof loadToken !== 'number') {
            throw new TypeError('sample load did not include a numeric token');
        }
        emit({ type: 'sampleLoadError', loadToken, message: 'sample pool exhausted' });

        await expect(preparation).resolves.toBe('failed');
        expect(listenerCount()).toBe(0);
    });

    it('cancels a committed-sample wait when the owning device is removed', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        decodeMock.mockResolvedValue({
            data: new Float32Array([0.5]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        const controller = new AbortController();
        const { port, posts, emit, listenerCount } = recordingPort();

        const preparation = prepareCrumbsEngine({ deviceId: DEVICE, port, signal: controller.signal });
        await vi.waitFor(() => expect(messagesOfType(posts, 'loadSample')).toHaveLength(1));
        const loadToken = messagesOfType(posts, 'loadSample')[0]?.loadToken;
        if (typeof loadToken !== 'number') {
            throw new TypeError('sample load did not include a numeric token');
        }
        controller.abort();
        await expect(preparation).resolves.toBe('cancelled');
        expect(listenerCount()).toBe(0);

        emit({ type: 'sampleLoaded', loadToken });
        expect(messagesOfType(posts, 'loadSample')).toHaveLength(1);
    });

    it('removes its listener when transferring the sample fails', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        decodeMock.mockResolvedValue({
            data: new Float32Array([0.5]),
            frameCount: 1,
            channels: 1,
            sampleRate: 48_000,
        });
        const { port, listenerCount } = recordingPort({ loadPostError: new Error('port closed') });

        await expect(prepareCrumbsEngine({ deviceId: DEVICE, port })).resolves.toBe('failed');

        expect(listenerCount()).toBe(0);
        expect(String(warnMock.mock.calls[0]?.[0])).toContain('port closed');
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

        const outcome = await prepareCrumbsEngine({ deviceId: DEVICE, port });

        expect(decodeMock).not.toHaveBeenCalled();
        expect(outcome).toBe('ready');
        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
    });

    it('seeds an unopened project device and prepares its silent default state', async () => {
        const { port, posts } = recordingPort();

        const outcome = await prepareCrumbsEngine({ deviceId: 'never-created', port });

        expect(crumbsStore.value?.['never-created']).toBeDefined();
        expect(messagesOfType(posts, 'mode')).toEqual([{ type: 'mode', mode: 'quick' }]);
        expect(outcome).toBe('ready');
    });

    // Throwing here would abort the caller's device setup, and `buildDeviceChain`
    // reads a missing entry as "this track has no instrument" — which substitutes
    // the fallback synth. A silent Crumbs is recoverable; a sawtooth is not.
    it('reports a failed decode and leaves the engine unloaded instead of throwing', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/missing.wav'));
        decodeMock.mockRejectedValue(new Error('ENOENT'));
        const { port, posts } = recordingPort();

        await expect(prepareCrumbsEngine({ deviceId: DEVICE, port })).resolves.toBe('failed');

        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
        expect(String(warnMock.mock.calls[0]?.[0])).toContain('/samples/missing.wav');
    });

    it('settles cancellation without waiting for a stalled decoder', async () => {
        ensureInstance(DEVICE);
        setActiveSample(DEVICE, sampleMeta('/samples/break.wav'));
        const controller = new AbortController();
        const decoding = Promise.withResolvers<never>();
        decodeMock.mockReturnValue(decoding.promise);
        const { port, posts } = recordingPort();

        let outcome: string | undefined;
        const preparation = prepareCrumbsEngine({ deviceId: DEVICE, port, signal: controller.signal }).then((value) => {
            outcome = value;
            return value;
        });
        controller.abort();
        await vi.waitFor(() => expect(outcome).toBe('cancelled'));

        expect(messagesOfType(posts, 'loadSample')).toEqual([]);
        await preparation;
    });
});
