/**
 * Durable tempo, meter, and loop maps must reach a live native session when
 * the stores that own them change during playback (#3109).
 *
 * The five loop gestures in #3107 called the maps write themselves. That
 * missed every other writer — `addTempoChange` never touches `transportStore`,
 * and a CRDT `fromCrdt` hydrate writes the stores without going through a
 * gesture. The store boundary is the subject: if a maps-relevant `set` while
 * playing does not reach `updateNativeLiveGraphSessionTransportMaps`, the
 * native session keeps the pair play was pressed with.
 *
 * `updateNativeLiveGraphSessionTransportMaps` is the double. The projected
 * maps are real, because "the function was called" would pass for a send that
 * restated the stale pair.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultTransportState, type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { initNativeLiveGraphTransportMapsSync } from '../initNativeLiveGraphTransportMapsSync';
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

const mocks = vi.hoisted(() => ({
    updateTransportMaps: vi.fn<MapsUpdate>(),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    startNativeLiveGraphSession: vi.fn(),
    updateNativeLiveGraphSessionTransportMaps: mocks.updateTransportMaps,
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
        transportStore.set({ ...defaultTransportState });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        mocks.updateTransportMaps.mockReset();
        mocks.updateTransportMaps.mockResolvedValue({ outcome: 'updated' });
        mocks.logger.debug.mockClear();
        mocks.logger.warn.mockClear();
        unsubscribe = initNativeLiveGraphTransportMapsSync();
    });

    afterEach(() => {
        unsubscribe();
    });

    it('sends projected tempo segments when addTempoChange runs during playback', () => {
        playingTransport();
        mocks.updateTransportMaps.mockClear();
        tempoMapStore.set({
            changes: [{ id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' }],
        });
        mocks.updateTransportMaps.mockClear();

        addTempoChange(8, 60);

        expect(sentMaps()?.tempo).toEqual([
            { startSeconds: 0, beatsPerMinute: 120 },
            { startSeconds: 4, beatsPerMinute: 60 },
        ]);
    });

    it('sends the projected loop region when a CRDT-like store set writes loop fields during playback', () => {
        playingTransport();
        mocks.updateTransportMaps.mockClear();

        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
        });

        expect(sentMaps()?.loopRegion).toEqual({ enabled: true, startSeconds: 2, endSeconds: 4 });
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

    it('does not send maps-relevant writes while the transport is not playing', () => {
        playingTransport({ isPlaying: false });
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
