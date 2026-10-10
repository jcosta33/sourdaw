import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';
import { syncAutoInputMonitoring } from '../syncAutoInputMonitoring';

import type { Store } from '#/infra/store/types';

type InputMonitoring = 'auto' | 'on' | 'off';

type TestTrack = {
    id: string;
    kind: 'audio';
    armed: boolean;
    inputMonitoring: InputMonitoring;
    inputId: string | null;
};

type TestTransport = { isPlaying: boolean; isRecording: boolean };

type TestSource = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

type TestStream = { stream: MediaStream; stopTrack: ReturnType<typeof vi.fn> };

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    createMediaStreamSource: vi.fn<(stream: MediaStream) => TestSource>(),
    ensureTrackStrip: vi.fn<(trackId: string) => { gainNode: unknown }>(),
    /** Every settlement of a use-case open, so the test can wait on the real promise the owner chains on. */
    opens: [] as Promise<boolean>[],
}));

// The real use cases and repository run; only the engine they feed is replaced.
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

vi.mock('#/modules/Transport/stores', async (importOriginal) => {
    const { createStore: create } = await import('#/infra/store/createStore');
    stores.transportStore = create<TestTransport>();
    return {
        ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
        transportStore: stores.transportStore,
        defaultTransportState: { isPlaying: false, isRecording: false },
    };
});

const originalMediaDevices = globalThis.navigator.mediaDevices;
const GAIN_NODE = { name: 'strip-gain' };

function track(inputMonitoring: InputMonitoring): TestTrack {
    return { id: 'track-1', kind: 'audio', armed: true, inputMonitoring, inputId: 'input-1' };
}

/** A write that reaches the track store without any monitoring gesture or graph reset. */
function writeStoreOnly(inputMonitoring: InputMonitoring): void {
    stores.trackStore.set({ tracks: [track(inputMonitoring)] });
}

function liveStream(): TestStream {
    const stopTrack = vi.fn();
    return { stream: { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream, stopTrack };
}

/** Queues one still-unsettled getUserMedia the test grants by hand. */
function deferGrant(): (granted: TestStream) => void {
    let resolveRequest!: (stream: MediaStream) => void;
    harness.getUserMedia.mockReturnValueOnce(
        new Promise<MediaStream>((resolve) => {
            resolveRequest = resolve;
        })
    );
    return (granted) => resolveRequest(granted.stream);
}

describe('reconcileAutoInputMonitoring when a track leaves Auto without a gesture', () => {
    let source: TestSource;
    let unsubscribe: (() => void) | null = null;

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
        source = { connect: vi.fn(), disconnect: vi.fn() };
        harness.createMediaStreamSource.mockReturnValue(source);
        stores.transportStore.set({ isPlaying: false, isRecording: false });
        stores.trackStore.set({ tracks: [track('auto')] });
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
        stopInputMonitoring();
        stores.trackStore.set({ tracks: [] });
        reconcileAutoInputMonitoring();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('releases a live Auto edge when a store-only write turns the track Off', async () => {
        const grant = deferGrant();
        reconcileAutoInputMonitoring();
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);

        writeStoreOnly('off');
        reconcileAutoInputMonitoring();

        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it('connects nothing and stops the stream when Off lands before a pending grant resolves', async () => {
        const grant = deferGrant();
        reconcileAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        writeStoreOnly('off');
        reconcileAutoInputMonitoring();
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];

        expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it('connects nothing and stops the stream when a store-only On then Off lands before a pending grant resolves', async () => {
        const grant = deferGrant();
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

        writeStoreOnly('on');
        writeStoreOnly('off');
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];

        expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it('releases a live Auto edge and its capture after a store-only On then Off', async () => {
        const grant = deferGrant();
        unsubscribe = syncAutoInputMonitoring();
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);

        writeStoreOnly('on');
        writeStoreOnly('off');

        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it('keeps the Auto edge after a store-only On with no later Off', async () => {
        const grant = deferGrant();
        unsubscribe = syncAutoInputMonitoring();
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];

        writeStoreOnly('on');

        expect(source.disconnect).not.toHaveBeenCalled();
        expect(granted.stopTrack).not.toHaveBeenCalled();
    });

    it('keeps a live Auto edge when the track moves to On', async () => {
        const grant = deferGrant();
        reconcileAutoInputMonitoring();
        const granted = liveStream();
        grant(granted);
        await harness.opens[0];

        writeStoreOnly('on');
        reconcileAutoInputMonitoring();

        expect(source.disconnect).not.toHaveBeenCalled();
        expect(granted.stopTrack).not.toHaveBeenCalled();
    });
});
