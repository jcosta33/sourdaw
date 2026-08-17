import { describe, it, expect, vi, beforeEach } from 'vitest';

import { pausePlayback } from '../pausePlayback';
import { startPlayback } from '../startPlayback';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn<() => Record<string, unknown>>(),
    updateTransportState: vi.fn<(...args: unknown[]) => void>(),
    stopPlayheadScheduler: vi.fn<() => void>(),
    startPlayheadScheduler: vi.fn<() => void>(),
    stopAllScheduled: vi.fn<() => void>(),
    resetMidiState: vi.fn<() => void>(),
    resumeEngine: vi.fn<() => void>(),
    ensureTrackStrips: vi.fn<() => void>(),
    playheadPositionRef: { current: 0 },
}));

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: mocks.updateTransportState,
}));

vi.mock('#/modules/Transport/stores/playheadPositionRef', () => ({
    playheadPositionRef: mocks.playheadPositionRef,
}));

// Pre-roll reads the meter map; keep this spec off the persistence-backed store.
vi.mock('#/modules/Transport/stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));

vi.mock('#/modules/Transport/useCases/playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));
vi.mock('#/modules/Transport/useCases/playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: mocks.stopPlayheadScheduler,
}));

// Mock the direct file path for ensureTrackStrips
vi.mock('#/modules/Transport/useCases/ensureTrackStrips', () => ({
    ensureTrackStrips: mocks.ensureTrackStrips,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    resumeEngine: mocks.resumeEngine,
    stopAllScheduled: mocks.stopAllScheduled,
    resetMidiState: mocks.resetMidiState,
}));

describe('Pause/Start Playback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.playheadPositionRef.current = 0;
    });

    describe('pausePlayback', () => {
        it('stops scheduler, engine nodes, and updates state', async () => {
            // Model the real flow: pausePlayback commits isPlaying:false via
            // updateTransportState, so the deferred teardown continuation
            // observes the paused state rather than a stale isPlaying:true.
            const liveState: Record<string, unknown> = { isPlaying: true };
            mocks.getTransportState.mockReturnValue(liveState);
            mocks.updateTransportState.mockImplementation((...args) => {
                Object.assign(liveState, args[0]);
            });

            pausePlayback();

            await vi.waitFor(() => expect(mocks.stopPlayheadScheduler).toHaveBeenCalled());
            expect(mocks.stopAllScheduled).toHaveBeenCalled();
            expect(mocks.updateTransportState).toHaveBeenCalledWith({
                isPlaying: false,
                isRecording: false,
                playheadPosition: 0,
            });
        });
    });

    describe('pause → play continuity', () => {
        it('resumes from the pause position after the playhead advanced during playback', async () => {
            // A play started at beat 0: the scheduler advanced the live
            // playhead (the ref — the only channel it writes) to beat 100 while
            // the store still holds the position where playback started.
            const liveState: Record<string, unknown> = {
                isPlaying: true,
                playheadPosition: 0,
                preRollEnabled: false,
            };
            mocks.getTransportState.mockReturnValue(liveState);
            mocks.updateTransportState.mockImplementation((...args) => {
                Object.assign(liveState, args[0]);
            });
            mocks.playheadPositionRef.current = 100;

            pausePlayback();
            await vi.waitFor(() => expect(mocks.stopPlayheadScheduler).toHaveBeenCalled());

            startPlayback();

            expect(mocks.updateTransportState).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 100 });
            expect(mocks.playheadPositionRef.current).toBe(100);
        });
    });

    describe('startPlayback', () => {
        it('resumes engine, ensures strips, and starts scheduler', async () => {
            mocks.getTransportState.mockReturnValue({
                playheadPosition: 10,
                preRollEnabled: false,
            });

            startPlayback();

            await vi.waitFor(() => {
                expect(mocks.resumeEngine).toHaveBeenCalled();
                expect(mocks.ensureTrackStrips).toHaveBeenCalled();
                expect(mocks.updateTransportState).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 10 });
                expect(mocks.playheadPositionRef.current).toBe(10);
                expect(mocks.startPlayheadScheduler).toHaveBeenCalled();
            });
        });

        it('calculates pre-roll position if enabled', async () => {
            mocks.getTransportState.mockReturnValue({
                playheadPosition: 16,
                preRollEnabled: true,
                preRollBars: 2,
                timeSignatureNumerator: 4,
                // Pre-roll now measures whole bars, so the bar length needs both
                // halves of the meter — a 4/4 bar is four quarter notes.
                timeSignatureDenominator: 4,
            });

            startPlayback();

            // Two 4/4 bars back from beat 16.
            await vi.waitFor(() => {
                expect(mocks.updateTransportState).toHaveBeenCalledWith(
                    expect.objectContaining({
                        playheadPosition: 8,
                    })
                );
                expect(mocks.playheadPositionRef.current).toBe(8);
            });
        });
    });
});
