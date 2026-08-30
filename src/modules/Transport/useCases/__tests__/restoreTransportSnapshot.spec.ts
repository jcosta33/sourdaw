import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import {
    hasLiveNativeGraphSession,
    repositionNativeLiveGraphSession,
    setMasterGainValue,
    stopNativeLiveGraphSession,
    updateNativeLiveGraphSessionTransportMaps,
} from '#/modules/AudioEngine/useCases';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { defaultTransportState, transportStore, type TransportState } from '../../stores/transportStore';
import { restoreTransportSnapshot } from '../restoreTransportSnapshot';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setMasterGainValue: vi.fn(),
    hasLiveNativeGraphSession: vi.fn(() => false),
    updateNativeLiveGraphSessionTransportMaps: vi.fn(() => Promise.resolve({ outcome: 'updated' })),
    repositionNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'repositioned' })),
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'stopped' })),
}));

const looping_snapshot = {
    tempo: 120,
    isLooping: true,
    loopStart: 4,
    loopEnd: 12,
} as const;

function reset_transport_store(): void {
    transportStore.set({ ...defaultTransportState });
    playheadPositionRef.current = 0;
    tempoMapStore.set({ changes: [] });
    timeSignatureMapStore.set({ changes: [] });
}

function restore_during_playback(snapshot: unknown): void {
    transportStore.set({
        ...defaultTransportState,
        isPlaying: true,
        tempo: 90,
        playheadPosition: 16,
    });
    playheadPositionRef.current = 42;
    vi.mocked(hasLiveNativeGraphSession).mockReturnValue(true);
    restoreTransportSnapshot(snapshot);
}

describe('restoreTransportSnapshot', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        reset_transport_store();
        vi.mocked(setMasterGainValue).mockClear();
        vi.mocked(hasLiveNativeGraphSession).mockClear();
        vi.mocked(hasLiveNativeGraphSession).mockReturnValue(false);
        vi.mocked(updateNativeLiveGraphSessionTransportMaps).mockClear();
        vi.mocked(repositionNativeLiveGraphSession).mockClear();
        vi.mocked(stopNativeLiveGraphSession).mockClear();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('restores durable fields while resetting runtime fields from a legacy full transport state', () => {
        const legacy_snapshot = {
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            overdubEnabled: true,
            playheadPosition: 64,
            scheduleGrainMs: 1,
            tempo: 150,
            timeSignatureNumerator: 7,
            timeSignatureDenominator: 8,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 95,
        } satisfies TransportState;

        restoreTransportSnapshot(legacy_snapshot);

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 150,
            timeSignatureNumerator: 7,
            timeSignatureDenominator: 8,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
            metronomeEnabled: true,
            metronomeVolume: 0.75,
            punchInEnabled: true,
            punchInBeat: 2,
            punchOutBeat: 10,
            countInEnabled: true,
            countInBars: 2,
            preRollEnabled: true,
            preRollBars: 3,
            masterGain: 95,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.95);
    });

    it('sanitizes a fully malformed durable snapshot to the default transport state', () => {
        restoreTransportSnapshot({ tempo: 19 });

        expect(transportStore.value).toEqual(defaultTransportState);
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });

    it('resets only the invalid field and preserves the other valid durable field (per-field contract, not the retired full-state collapse)', () => {
        restoreTransportSnapshot({ tempo: 19, masterGain: 90 });

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: defaultTransportState.tempo,
            masterGain: 90,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(0.9);
    });

    it('resets the full loop trio for a fabricated region instead of only the rejected member', () => {
        restoreTransportSnapshot({ isLooping: true, loopStart: -1, loopEnd: 16 });

        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            isLooping: defaultTransportState.isLooping,
            loopStart: defaultTransportState.loopStart,
            loopEnd: defaultTransportState.loopEnd,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });

    describe('native live session while playing', () => {
        it('reinstalls restored tempo and loop maps after the store write', () => {
            restore_during_playback(looping_snapshot);

            expect(updateNativeLiveGraphSessionTransportMaps).toHaveBeenCalledWith({
                transportMaps: projectEngineTransportMaps(),
            });
            expect(vi.mocked(updateNativeLiveGraphSessionTransportMaps).mock.lastCall?.[0].transportMaps).toEqual(
                expect.objectContaining({
                    tempo: [expect.objectContaining({ startSeconds: 0, beatsPerMinute: 120 })],
                    loopRegion: { enabled: true, startSeconds: 2, endSeconds: 6 },
                })
            );
        });

        it('locates the rolling engine at the restored playhead, not the pre-restore live beat', () => {
            restore_during_playback({ ...looping_snapshot, playheadPosition: 64 });

            expect(repositionNativeLiveGraphSession).toHaveBeenCalledWith({ positionSeconds: 0 });
        });

        it('parks the engine at the same restored position', () => {
            restore_during_playback({ ...looping_snapshot, playheadPosition: 64 });

            expect(stopNativeLiveGraphSession).toHaveBeenCalledWith({ positionSeconds: 0 });
        });

        it('sends maps, then locate, then park for a tempo-and-loop restore', () => {
            restore_during_playback(looping_snapshot);

            expect(updateNativeLiveGraphSessionTransportMaps).toHaveBeenCalledTimes(1);
            expect(repositionNativeLiveGraphSession).toHaveBeenCalledTimes(1);
            expect(stopNativeLiveGraphSession).toHaveBeenCalledTimes(1);
            const maps_order = vi.mocked(updateNativeLiveGraphSessionTransportMaps).mock.invocationCallOrder[0];
            const locate_order = vi.mocked(repositionNativeLiveGraphSession).mock.invocationCallOrder[0];
            const park_order = vi.mocked(stopNativeLiveGraphSession).mock.invocationCallOrder[0];
            expect(maps_order).toBeLessThan(locate_order ?? Number.POSITIVE_INFINITY);
            expect(locate_order).toBeLessThan(park_order ?? Number.NEGATIVE_INFINITY);
        });
    });

    it('sends nothing native when restoring while stopped, even with a live session', () => {
        vi.mocked(hasLiveNativeGraphSession).mockReturnValue(true);

        restoreTransportSnapshot(looping_snapshot);

        expect(hasLiveNativeGraphSession).not.toHaveBeenCalled();
        expect(updateNativeLiveGraphSessionTransportMaps).not.toHaveBeenCalled();
        expect(repositionNativeLiveGraphSession).not.toHaveBeenCalled();
        expect(stopNativeLiveGraphSession).not.toHaveBeenCalled();
        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 120,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });

    it('sends nothing native when playing without a live session, and still writes the store and master gain', () => {
        transportStore.set({ ...defaultTransportState, isPlaying: true });
        vi.mocked(hasLiveNativeGraphSession).mockReturnValue(false);

        restoreTransportSnapshot(looping_snapshot);

        expect(hasLiveNativeGraphSession).toHaveBeenCalled();
        expect(updateNativeLiveGraphSessionTransportMaps).not.toHaveBeenCalled();
        expect(repositionNativeLiveGraphSession).not.toHaveBeenCalled();
        expect(stopNativeLiveGraphSession).not.toHaveBeenCalled();
        expect(transportStore.value).toEqual({
            ...defaultTransportState,
            tempo: 120,
            isLooping: true,
            loopStart: 4,
            loopEnd: 12,
        });
        expect(setMasterGainValue).toHaveBeenCalledWith(defaultTransportState.masterGain / 100);
    });
});
