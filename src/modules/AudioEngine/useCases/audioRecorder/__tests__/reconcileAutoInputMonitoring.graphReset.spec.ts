import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';

import type { Store } from '#/infra/store/types';

type TestTrack = {
    id: string;
    kind: 'audio';
    armed: boolean;
    inputMonitoring: 'auto';
    inputId: string | null;
};

type TestTransport = { isPlaying: boolean; isRecording: boolean };

type Grant = {
    grant: (stream: MediaStream) => void;
    reject: (error: Error) => void;
};

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    createMediaStreamSource:
        vi.fn<(stream: MediaStream) => { connect: (node: unknown) => void; disconnect: () => void }>(),
    ensureTrackStrip: vi.fn<(trackId: string) => { gainNode: unknown }>(),
    /** Every settlement of a use-case open, so the test can wait on the real promise the owner chains on. */
    opens: [] as Promise<boolean>[],
}));

// The real use case and repository run; only the engine they feed is replaced.
// The wrapper hands the test the open's own promise, which the owner has
// already chained on, so awaiting it also awaits the owner's settlement.
vi.mock('../startInputMonitoring', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../startInputMonitoring')>();
    return {
        startInputMonitoring: (trackId: string, inputId?: string | null): Promise<boolean> => {
            const open = actual.startInputMonitoring(trackId, inputId);
            harness.opens.push(open);
            return open;
        },
    };
});
vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { createMediaStreamSource: harness.createMediaStreamSource },
        ensureTrackStrip: harness.ensureTrackStrip,
    },
}));

const stores = vi.hoisted(() => ({
    trackStore: null as unknown as Store<{ tracks: TestTrack[] }>,
    transportStore: null as unknown as Store<TestTransport>,
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.trackStore = create<{ tracks: TestTrack[] }>();
    return {
        ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
        trackStore: stores.trackStore,
    };
});

vi.mock('#/modules/Transport/stores', async () => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.transportStore = create<TestTransport>();
    return {
        transportStore: stores.transportStore,
        defaultTransportState: { isPlaying: false, isRecording: false },
    };
});

const originalMediaDevices = globalThis.navigator.mediaDevices;
const GAIN_NODE = { name: 'strip-gain' };

function armedTrack(armed = true): TestTrack {
    return { id: 'track-1', kind: 'audio', armed, inputMonitoring: 'auto', inputId: 'input-1' };
}

function liveStream(): MediaStream {
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
}

/** Queues one still-unsettled getUserMedia the test settles by hand. */
function deferGrant(): Grant {
    let resolveRequest!: (stream: MediaStream) => void;
    let rejectRequest!: (error: Error) => void;
    harness.getUserMedia.mockReturnValueOnce(
        new Promise<MediaStream>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        })
    );
    return { grant: (stream) => resolveRequest(stream), reject: (error) => rejectRequest(error) };
}

async function settleOpen(index: number): Promise<void> {
    await harness.opens[index];
}

describe('reconcileAutoInputMonitoring across a graph reset', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia: harness.getUserMedia },
            configurable: true,
        });
        stopInputMonitoring();
        harness.opens.length = 0;
        harness.getUserMedia.mockReset();
        harness.createMediaStreamSource.mockReset();
        harness.ensureTrackStrip.mockReset();
        harness.ensureTrackStrip.mockReturnValue({ gainNode: GAIN_NODE });
        harness.createMediaStreamSource.mockReturnValue({ connect: vi.fn(), disconnect: vi.fn() });
        stores.trackStore.set({ tracks: [armedTrack()] });
        stores.transportStore.set({ isPlaying: false, isRecording: false });
    });

    afterEach(() => {
        stopInputMonitoring();
        stores.trackStore.set({ tracks: [] });
        reconcileAutoInputMonitoring();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('opens the edge again after a grant that outlived a graph reset resolves', async () => {
        const first = deferGrant();
        reconcileAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        stopInputMonitoring();
        first.grant(liveStream());
        await settleOpen(0);

        const second = deferGrant();
        reconcileAutoInputMonitoring();

        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
        second.grant(liveStream());
        await settleOpen(1);
        const source = harness.createMediaStreamSource.mock.results[0]?.value as { connect: ReturnType<typeof vi.fn> };
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);
    });

    it('keeps suppressing retries after a genuine rejection until the edge is closed in between', async () => {
        const denied = deferGrant();
        reconcileAutoInputMonitoring();
        denied.reject(new Error('NotAllowedError'));
        await settleOpen(0);

        reconcileAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        stores.trackStore.set({ tracks: [armedTrack(false)] });
        reconcileAutoInputMonitoring();
        deferGrant();
        stores.trackStore.set({ tracks: [armedTrack()] });
        reconcileAutoInputMonitoring();

        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
    });
});
