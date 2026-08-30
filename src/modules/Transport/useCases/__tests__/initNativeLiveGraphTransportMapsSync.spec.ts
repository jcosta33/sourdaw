/**
 * Durable tempo, meter, and loop maps must reach a live native session when
 * the stores that own them change during playback (#3109).
 *
 * The five loop gestures in #3107 called the maps write themselves. That
 * missed every other writer — `addTempoChange` never touches `transportStore`,
 * and a CRDT `fromCrdt` hydrate writes the stores without going through a
 * gesture. The store boundary is the subject: if a maps-relevant `set` while
 * playing or while a native session is held does not reach
 * `updateNativeLiveGraphSessionTransportMaps`, the native session keeps the
 * pair play was pressed with.
 *
 * `updateNativeLiveGraphSessionTransportMaps` is the double. The projected
 * maps are real, because "the function was called" would pass for a send that
 * restated the stale pair. Tempo and meter writes also locate the rolling
 * session so `song_pos_beats` stays on the UI beat after the maps replace the
 * beat↔seconds integral.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { defaultTransportState, type TransportState } from '../../models/TransportState';
import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { initNativeLiveGraphTransportMapsSync } from '../initNativeLiveGraphTransportMapsSync';
import { setTempo } from '../setTempo';
import { addTempoChange } from '../tempoMap/addTempoChange';
import { addTimeSignatureChange } from '../timeSignatureChanges/addTimeSignatureChange';

type EngineTransportMaps = {
    tempo: ReadonlyArray<{ startSeconds: number; beatsPerMinute: number }>;
    timeSignature: ReadonlyArray<{ startSeconds: number; numerator: number; denominator: number }>;
    loopRegion: { enabled: boolean; startSeconds: number; endSeconds: number } | null;
};

type MapsUpdate = (input: {
    transportMaps: EngineTransportMaps;
}) => Promise<{ outcome: 'updated' } | { outcome: 'declined'; reason: string }>;

type Reposition = (input: {
    positionSeconds: number;
}) => Promise<{ outcome: 'repositioned' } | { outcome: 'declined'; reason: string }>;

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

const mocks = vi.hoisted(() => ({
    updateTransportMaps: vi.fn<MapsUpdate>(),
    reposition: vi.fn<Reposition>(),
    isNativeLiveGraphSessionHeld: vi.fn<() => boolean>(),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startNativeLiveGraphSession: vi.fn(),
    isNativeLiveGraphSessionHeld: mocks.isNativeLiveGraphSessionHeld,
    updateNativeLiveGraphSessionTransportMaps: mocks.updateTransportMaps,
    repositionNativeLiveGraphSession: mocks.reposition,
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

function sentMaps(): EngineTransportMaps | undefined {
    return mocks.updateTransportMaps.mock.lastCall?.[0].transportMaps;
}

function playingTransport(overrides?: Partial<TransportState>): void {
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: true,
        ...overrides,
    });
}

describe('without observing the stores', () => {
    beforeEach(() => {
        mocks.updateTransportMaps.mockReset();
        mocks.updateTransportMaps.mockResolvedValue({ outcome: 'updated' });
        mocks.reposition.mockReset();
        mocks.reposition.mockResolvedValue({ outcome: 'repositioned' });
        mocks.isNativeLiveGraphSessionHeld.mockReturnValue(true);
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
    });

    it('does not send when loop fields are written while playing', () => {
        playingTransport({ isLooping: true, loopStart: 4, loopEnd: 8 });

        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('does not send when addTempoChange runs while playing', () => {
        playingTransport();

        addTempoChange(8, 60);

        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});

describe('initNativeLiveGraphTransportMapsSync', () => {
    let unsubscribe: () => void;

    beforeEach(() => {
        unsubscribe?.();
        configureAutomergeStoragePort(null);
        clear_fake_doc();
        configure_fake_crdt_port();
        transportStore.set({ ...defaultTransportState });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        playheadPositionRef.current = 0;
        mocks.updateTransportMaps.mockReset();
        mocks.updateTransportMaps.mockResolvedValue({ outcome: 'updated' });
        mocks.reposition.mockReset();
        mocks.reposition.mockResolvedValue({ outcome: 'repositioned' });
        mocks.isNativeLiveGraphSessionHeld.mockReturnValue(true);
        mocks.logger.debug.mockClear();
        mocks.logger.warn.mockClear();
        unsubscribe = initNativeLiveGraphTransportMapsSync();
    });

    afterEach(() => {
        unsubscribe();
        configureAutomergeStoragePort(null);
    });

    it('sends projected tempo segments when addTempoChange runs during playback', () => {
        playingTransport();
        mocks.updateTransportMaps.mockClear();
        tempoMapStore.set({
            changes: [{ id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' }],
        });
        mocks.updateTransportMaps.mockClear();
        mocks.reposition.mockClear();

        addTempoChange(8, 60);

        expect(sentMaps()?.tempo).toEqual([
            { startSeconds: 0, beatsPerMinute: 120 },
            { startSeconds: 4, beatsPerMinute: 60 },
        ]);
    });

    it('sends the projected loop region when a CRDT-like store set writes loop fields during playback', () => {
        playingTransport();
        mocks.updateTransportMaps.mockClear();
        mocks.reposition.mockClear();

        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
        });

        expect(sentMaps()?.loopRegion).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
        expect(mocks.reposition).not.toHaveBeenCalled();
    });

    it('sends the projected tempo when setTempo writes transport.tempo on an empty map during playback', () => {
        playingTransport({ tempo: 120 });
        mocks.updateTransportMaps.mockClear();

        setTempo({ bpm: 90 });

        expect(sentMaps()?.tempo).toEqual([{ startSeconds: 0, beatsPerMinute: 90 }]);
    });

    it('relocates the rolling session to the current beat after setTempo changes the maps', () => {
        playingTransport({ tempo: 120 });
        playheadPositionRef.current = 8;
        mocks.updateTransportMaps.mockClear();
        mocks.reposition.mockClear();

        setTempo({ bpm: 60 });

        expect(mocks.updateTransportMaps).toHaveBeenCalledOnce();
        expect(mocks.reposition).toHaveBeenCalledOnce();
        expect(mocks.reposition).toHaveBeenCalledWith({ positionSeconds: 8 });
        expect(mocks.updateTransportMaps.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.reposition.mock.invocationCallOrder[0]!
        );
    });

    it('sends the projected loop and tempo when a live CRDT hydrate clears isPlaying but a session is held', () => {
        transportStore.set({
            ...defaultTransportState,
            isPlaying: true,
            tempo: 220,
        });
        mocks.updateTransportMaps.mockClear();
        fake_doc.transport = {
            tempo: 132,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
        };

        transportStore.hydrate();

        expect(transportStore.value?.isPlaying).toBe(false);
        expect(sentMaps()?.tempo).toEqual([{ startSeconds: 0, beatsPerMinute: 132 }]);
        expect(sentMaps()?.loopRegion).toEqual({
            enabled: true,
            startSeconds: 1.8181818181818181,
            endSeconds: 5.454545454545454,
        });
    });

    it('sends the projected meter map when a time-signature change is written during playback', () => {
        playingTransport();
        mocks.updateTransportMaps.mockClear();

        addTimeSignatureChange(4, 3, 4);

        expect(sentMaps()?.timeSignature).toEqual([
            { startSeconds: 0, numerator: 3, denominator: 4 },
            { startSeconds: 2, numerator: 3, denominator: 4 },
        ]);
    });

    it('does not send when only the playhead is written', () => {
        playingTransport({ isLooping: true, loopStart: 4, loopEnd: 8 });
        mocks.updateTransportMaps.mockClear();

        transportStore.set({
            ...transportStore.value!,
            playheadPosition: 16,
        });

        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('does not send when only the metronome is written', () => {
        playingTransport({ isLooping: true, loopStart: 4, loopEnd: 8 });
        mocks.updateTransportMaps.mockClear();

        transportStore.set({
            ...transportStore.value!,
            metronomeEnabled: true,
        });

        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });

    it('sends maps-relevant writes while playing even when no native session is held yet', () => {
        playingTransport();
        mocks.isNativeLiveGraphSessionHeld.mockReturnValue(false);
        mocks.updateTransportMaps.mockClear();

        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
        });

        expect(mocks.updateTransportMaps).toHaveBeenCalledOnce();
        expect(sentMaps()?.loopRegion).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
    });

    it('does not send maps-relevant writes when neither playing nor a native session is held', () => {
        transportStore.set({ ...defaultTransportState, tempo: 120, isPlaying: false });
        mocks.isNativeLiveGraphSessionHeld.mockReturnValue(false);
        mocks.updateTransportMaps.mockClear();

        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
        });
        addTempoChange(8, 60);

        expect(mocks.updateTransportMaps).not.toHaveBeenCalled();
    });
});
