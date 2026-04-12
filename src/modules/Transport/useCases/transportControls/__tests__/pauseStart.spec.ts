import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pausePlayback } from '../pausePlayback';
import { startPlayback } from '../startPlayback';

const mocks = vi.hoisted(() => ({
    getTransportState: vi.fn(),
    updateTransportState: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
    startPlayheadScheduler: vi.fn(),
    stopAllScheduled: vi.fn(),
    resetMidiState: vi.fn(),
    resumeEngine: vi.fn(),
    ensureTrackStrips: vi.fn(),
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

vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    stopPlayheadScheduler: mocks.stopPlayheadScheduler,
    startPlayheadScheduler: mocks.startPlayheadScheduler,
}));

// Mock the direct file path for ensureTrackStrips
vi.mock('#/modules/Transport/useCases/ensureTrackStrips', () => ({
    ensureTrackStrips: mocks.ensureTrackStrips,
}));

// Mock the individual engine files exactly as imported in startPlayback.ts
vi.mock('#/modules/AudioEngine/useCases/engineAccess/resumeEngine', () => ({
    resumeEngine: mocks.resumeEngine,
}));

vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: mocks.stopAllScheduled,
}));

vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: mocks.resetMidiState,
}));

// ALSO mock the barrel re-export just in case
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
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
        it('stops scheduler, engine nodes, and updates state', () => {
            mocks.getTransportState.mockReturnValue({ isPlaying: true });

            pausePlayback();

            expect(mocks.stopPlayheadScheduler).toHaveBeenCalled();
            expect(mocks.stopAllScheduled).toHaveBeenCalled();
            expect(mocks.updateTransportState).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
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
            });

            startPlayback();

            // 16 - (2 * 4) = 8.
            await vi.waitFor(() => {
                expect(mocks.updateTransportState).toHaveBeenCalledWith(expect.objectContaining({
                    playheadPosition: 8,
                }));
                expect(mocks.playheadPositionRef.current).toBe(8);
            });
        });
    });
});
