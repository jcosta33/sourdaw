import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTrackEligibility, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    createTrack,
    rearmInputMonitoring,
    restoreTrackSnapshot,
    toggleInputMonitoring,
} from '#/modules/Arrangement/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { isTrackInputMonitored } from '../../../repositories/audioRecorder/isTrackInputMonitored';
import { reconcileAutoInputMonitoring } from '../reconcileAutoInputMonitoring';
import { startInputMonitoring } from '../startInputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';
import { suspendAutoInputMonitoring } from '../suspendAutoInputMonitoring';
import { syncAutoInputMonitoring } from '../syncAutoInputMonitoring';

type InputMonitoring = 'auto' | 'on' | 'off';

type TestSource = { connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

type TestStream = { stream: MediaStream; stopTrack: ReturnType<typeof vi.fn> };

const harness = vi.hoisted(() => ({
    getUserMedia: vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(),
    createMediaStreamSource: vi.fn<(stream: MediaStream) => TestSource>(),
    ensureTrackStrip: vi.fn<(trackId: string) => { gainNode: unknown }>(),
    /** Every settlement of a use-case open, so the test can wait on the real promise the owner chains on. */
    opens: [] as Promise<boolean>[],
}));

// The real use cases and repository run with controlled media and gain-node ports.
// These ports prove capture ownership, not hardware audio or real folder-strip creation.
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

const originalMediaDevices = globalThis.navigator.mediaDevices;
const GAIN_NODE = { name: 'strip-gain' };
const SECOND_GAIN_NODE = { name: 'second-strip-gain' };

function track(inputMonitoring: InputMonitoring, overrides: Partial<Track> = {}): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Audio 1', kind: 'audio', withoutDefaultDevice: true }),
        armed: true,
        inputMonitoring,
        inputId: 'input-1',
        ...overrides,
    };
}

/** The real version-restore track producer, without a monitoring gesture or graph reset. */
function writeStoreOnly(inputMonitoring: InputMonitoring): void {
    restoreTrackSnapshot({ tracks: [track(inputMonitoring)], selectedTrackId: null });
}

function publishTracks(tracks: Track[]): void {
    restoreTrackSnapshot({ tracks, selectedTrackId: null });
}

function readPublishedTrack(trackId: string): Track {
    const publishedTrack = trackStore.value?.tracks.find((value) => value.id === trackId);
    if (!publishedTrack) {
        throw new Error(`Expected track ${trackId} in the published track store`);
    }
    return publishedTrack;
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
    let releaseHold: (() => void) | null = null;

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
        harness.ensureTrackStrip.mockImplementation((trackId) => ({
            gainNode: trackId === 'track-2' ? SECOND_GAIN_NODE : GAIN_NODE,
        }));
        source = { connect: vi.fn(), disconnect: vi.fn() };
        harness.createMediaStreamSource.mockReturnValue(source);
        transportStore.set(defaultTransportState);
        publishTracks([track('auto')]);
    });

    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
        stopInputMonitoring();
        publishTracks([]);
        reconcileAutoInputMonitoring();
        releaseHold?.();
        releaseHold = null;
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it.each(['mode', 'input', 'owner'] as const)(
        'rejects a direct On grant after its %s changes without a reconciliation subscriber',
        async (change) => {
            publishTracks([track('on')]);
            const grant = deferGrant();
            const opening = startInputMonitoring('track-1', 'input-1');
            if (change === 'owner') {
                publishTracks([]);
            } else {
                publishTracks([
                    track(change === 'mode' ? 'off' : 'on', { inputId: change === 'input' ? 'input-2' : 'input-1' }),
                ]);
            }
            const granted = liveStream();
            grant(granted);

            expect(await opening).toBe(false);
            expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
            expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        }
    );

    it('moves an already admitted On edge to the selected input without admitting other store-only On tracks', async () => {
        publishTracks([track('on'), track('on', { id: 'track-2' })]);
        unsubscribe = syncAutoInputMonitoring();
        expect(harness.getUserMedia).not.toHaveBeenCalled();
        const oldGrant = deferGrant();
        const opening = startInputMonitoring('track-1', 'input-1');
        const oldStream = liveStream();
        oldGrant(oldStream);
        expect(await opening).toBe(true);
        const nextGrant = deferGrant();

        publishTracks([track('on', { inputId: 'input-2' }), track('on', { id: 'track-2' })]);

        expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
        expect(harness.getUserMedia).toHaveBeenLastCalledWith({
            audio: expect.objectContaining({ deviceId: { exact: 'input-2' } }),
        });
        expect(oldStream.stopTrack).toHaveBeenCalledTimes(1);
        const nextStream = liveStream();
        nextGrant(nextStream);
        await Promise.all(harness.opens);
        expect(isTrackInputMonitored('track-1', 'input-2')).toBe(true);
        expect(isTrackInputMonitored('track-2', 'input-1')).toBe(false);
    });

    it('retains an explicit global capture key through an unrelated publication of an unchanged selector', async () => {
        publishTracks([track('on')]);
        unsubscribe = syncAutoInputMonitoring();
        const grant = deferGrant();
        const opening = startInputMonitoring('track-1', 'global-input');
        const granted = liveStream();
        grant(granted);
        expect(await opening).toBe(true);

        publishTracks([track('on', { name: 'Renamed' })]);

        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        expect(isTrackInputMonitored('track-1', 'global-input')).toBe(true);
        expect(granted.stopTrack).not.toHaveBeenCalled();
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

    it.each(['audio', 'midi', 'bus', 'folder', 'master'] as const)(
        'keeps gesture-admitted %s On through play and stop, then releases only its shared owner on Off',
        async (kind) => {
            expect(getTrackEligibility(kind).acceptsMonitoring).toBe(true);
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            publishTracks([track('auto', { kind }), track('auto', { id: 'track-2' })]);
            unsubscribe = syncAutoInputMonitoring();
            expect(harness.getUserMedia).not.toHaveBeenCalled();
            const granted = liveStream();
            harness.getUserMedia.mockResolvedValueOnce(granted.stream);

            toggleInputMonitoring('track-1');
            expect(await harness.opens[0]).toBe(true);
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            expect(readPublishedTrack('track-1').inputMonitoring).toBe('on');
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(true);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(granted.stopTrack).not.toHaveBeenCalled();

            toggleInputMonitoring('track-2');
            expect(await harness.opens[1]).toBe(true);
            expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);
            expect(source.connect).toHaveBeenCalledWith(SECOND_GAIN_NODE);

            transportStore.set({ ...defaultTransportState, isPlaying: true });
            transportStore.set(defaultTransportState);

            expect(trackStore.value?.tracks.map((value) => value.inputMonitoring)).toEqual(['on', 'on']);
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(true);
            expect(isTrackInputMonitored('track-2', 'input-1')).toBe(true);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(granted.stopTrack).not.toHaveBeenCalled();

            toggleInputMonitoring('track-1');

            expect(readPublishedTrack('track-1').inputMonitoring).toBe('off');
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(false);
            expect(isTrackInputMonitored('track-2', 'input-1')).toBe(true);
            expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(GAIN_NODE);
            expect(source.disconnect).not.toHaveBeenCalledWith(SECOND_GAIN_NODE);
            expect(granted.stopTrack).not.toHaveBeenCalled();

            toggleInputMonitoring('track-2');

            expect(readPublishedTrack('track-2').inputMonitoring).toBe('off');
            expect(isTrackInputMonitored('track-2', 'input-1')).toBe(false);
            expect(source.disconnect).toHaveBeenCalledWith(SECOND_GAIN_NODE);
            expect(source.disconnect.mock.calls).toEqual([[GAIN_NODE], [SECOND_GAIN_NODE], []]);
            expect(granted.stopTrack).toHaveBeenCalledTimes(1);
            expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['midi', 'bus', 'folder', 'master'] as const)(
        'retains gesture-admitted %s On interest through transport publications before permission settles',
        async (kind) => {
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            publishTracks([track('auto', { kind })]);
            unsubscribe = syncAutoInputMonitoring();
            const grant = deferGrant();

            toggleInputMonitoring('track-1');
            expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(true);
            transportStore.set(defaultTransportState);
            transportStore.set({ ...defaultTransportState, isPlaying: true });
            const granted = liveStream();
            grant(granted);

            expect(await harness.opens[0]).toBe(true);
            expect(readPublishedTrack('track-1').inputMonitoring).toBe('on');
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(true);
            expect(source.connect).toHaveBeenCalledExactlyOnceWith(GAIN_NODE);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(granted.stopTrack).not.toHaveBeenCalled();

            toggleInputMonitoring('track-1');

            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(false);
            expect(source.disconnect.mock.calls).toEqual([[GAIN_NODE], []]);
            expect(granted.stopTrack).toHaveBeenCalledTimes(1);
            expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['audio', 'midi', 'bus', 'folder', 'master'] as const)(
        'never requests permission for unadmitted store-only %s On',
        (kind) => {
            publishTracks([track('on', { kind })]);
            unsubscribe = syncAutoInputMonitoring();

            transportStore.set({ ...defaultTransportState, isPlaying: true });
            transportStore.set(defaultTransportState);

            expect(readPublishedTrack('track-1').inputMonitoring).toBe('on');
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(false);
            expect(harness.getUserMedia).not.toHaveBeenCalled();
            expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
            expect(source.connect).not.toHaveBeenCalled();
        }
    );

    it('releases a direct On edge immediately when restore turns it Off during a hold', async () => {
        writeStoreOnly('on');
        unsubscribe = syncAutoInputMonitoring();
        const granted = liveStream();
        harness.getUserMedia.mockResolvedValueOnce(granted.stream);
        expect(await startInputMonitoring('track-1', 'input-1')).toBe(true);
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);
        releaseHold = suspendAutoInputMonitoring();

        writeStoreOnly('off');

        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        releaseHold();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it('cancels direct On interest before a held Off publication receives its late grant', async () => {
        writeStoreOnly('on');
        unsubscribe = syncAutoInputMonitoring();
        const grant = deferGrant();
        const opening = startInputMonitoring('track-1', 'input-1');
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        releaseHold = suspendAutoInputMonitoring();

        writeStoreOnly('off');
        const granted = liveStream();
        grant(granted);

        expect(await opening).toBe(false);
        expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
        expect(source.connect).not.toHaveBeenCalled();
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        releaseHold();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
    });

    it.each(['midi', 'bus', 'folder', 'master'] as const)(
        'keeps admitted On when the same identity becomes %s, then closes it on non-audio Auto',
        async (kind) => {
            writeStoreOnly('on');
            unsubscribe = syncAutoInputMonitoring();
            const granted = liveStream();
            harness.getUserMedia.mockResolvedValueOnce(granted.stream);
            expect(await startInputMonitoring('track-1', 'input-1')).toBe(true);

            publishTracks([track('on', { kind })]);

            expect(readPublishedTrack('track-1').inputMonitoring).toBe('on');
            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(true);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(granted.stopTrack).not.toHaveBeenCalled();

            publishTracks([track('auto', { kind })]);
            transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });
            transportStore.set(defaultTransportState);

            expect(isTrackInputMonitored('track-1', 'input-1')).toBe(false);
            expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
            expect(granted.stopTrack).toHaveBeenCalledTimes(1);
            expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        }
    );

    it.each(['midi', 'bus', 'folder', 'master'] as const)('never opens unadmitted %s Auto', (kind) => {
        publishTracks([track('auto', { kind })]);
        unsubscribe = syncAutoInputMonitoring();

        transportStore.set({ ...defaultTransportState, isPlaying: true });
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true });
        transportStore.set(defaultTransportState);

        expect(isTrackInputMonitored('track-1', 'input-1')).toBe(false);
        expect(harness.getUserMedia).not.toHaveBeenCalled();
        expect(harness.createMediaStreamSource).not.toHaveBeenCalled();
        expect(source.connect).not.toHaveBeenCalled();
    });

    it.each(['off', 'removed'] as const)(
        'releases only the direct On owner that becomes %s on a shared input',
        async (mode) => {
            const second = track('on', { id: 'track-2' });
            publishTracks([track('on'), second]);
            unsubscribe = syncAutoInputMonitoring();
            const granted = liveStream();
            harness.getUserMedia.mockResolvedValueOnce(granted.stream);
            expect(await startInputMonitoring('track-1', 'input-1')).toBe(true);
            expect(await startInputMonitoring('track-2', 'input-1')).toBe(true);
            expect(source.connect).toHaveBeenCalledWith(SECOND_GAIN_NODE);

            // A controlled collaborator projection uses the same real store publication as CRDT hydration.
            trackStore.set({ tracks: mode === 'off' ? [track('off'), second] : [second], selectedTrackId: null });

            expect(source.disconnect).toHaveBeenCalledExactlyOnceWith(GAIN_NODE);
            expect(granted.stopTrack).not.toHaveBeenCalled();
            expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
            publishTracks([track('off', { id: 'track-2' })]);
            expect(source.disconnect).toHaveBeenCalledWith(SECOND_GAIN_NODE);
            expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        }
    );

    it('does not acquire from store-only On, but observes a gesture and a later Off', async () => {
        writeStoreOnly('off');
        unsubscribe = syncAutoInputMonitoring();
        releaseHold = suspendAutoInputMonitoring();
        writeStoreOnly('on');
        expect(harness.getUserMedia).not.toHaveBeenCalled();
        const granted = liveStream();
        harness.getUserMedia.mockResolvedValueOnce(granted.stream);

        writeStoreOnly('auto');
        toggleInputMonitoring('track-1');
        await harness.opens[0];
        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);
        writeStoreOnly('off');

        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        releaseHold();
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('suppresses transient Auto opens while a held rebuild re-arms On, then cleans the rearm on Off', async () => {
        const onTrack = track('on');
        const autoTrack = track('auto', { id: 'track-2', inputId: 'input-2' });
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        publishTracks([onTrack, autoTrack]);
        unsubscribe = syncAutoInputMonitoring();
        releaseHold = suspendAutoInputMonitoring();
        stopInputMonitoring();
        transportStore.set(defaultTransportState);
        const granted = liveStream();
        harness.getUserMedia.mockResolvedValueOnce(granted.stream);

        await rearmInputMonitoring([onTrack, autoTrack]);

        expect(source.connect).toHaveBeenCalledWith(GAIN_NODE);
        expect(source.connect).not.toHaveBeenCalledWith(SECOND_GAIN_NODE);
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        releaseHold();
        expect(granted.stopTrack).not.toHaveBeenCalled();
        publishTracks([track('off'), autoTrack]);
        expect(source.disconnect).toHaveBeenCalledWith(GAIN_NODE);
        expect(granted.stopTrack).toHaveBeenCalledTimes(1);
        expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    });
});
