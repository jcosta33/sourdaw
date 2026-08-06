import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    mockGetTransportState,
    mockUpdateTransportState,
    mockAdvanceEpoch,
    mockPanicYeast,
    mockStartScheduler,
    mockStopScheduler,
    mockStopAllScheduled,
    mockResetMidiState,
    mockStopActiveRecording,
} = vi.hoisted(() => ({
    mockGetTransportState: vi.fn(),
    mockUpdateTransportState: vi.fn(),
    mockAdvanceEpoch: vi.fn(),
    mockPanicYeast: vi.fn(() => Promise.resolve()),
    mockStartScheduler: vi.fn(),
    mockStopScheduler: vi.fn(),
    mockStopAllScheduled: vi.fn(),
    mockResetMidiState: vi.fn(),
    mockStopActiveRecording: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../repositories/transport/getTransportState', () => ({ getTransportState: mockGetTransportState }));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: mockUpdateTransportState,
}));
vi.mock('../../../stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));
vi.mock('../../playheadScheduler/advanceSchedulerDiscontinuityEpoch', () => ({
    advanceSchedulerDiscontinuityEpoch: mockAdvanceEpoch,
}));
vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({ startPlayheadScheduler: mockStartScheduler }));
vi.mock('../../playheadScheduler/stopPlayheadScheduler', () => ({ stopPlayheadScheduler: mockStopScheduler }));
vi.mock('../panicYeastRuntime', () => ({ panicYeastRuntime: mockPanicYeast }));
vi.mock('../stopActiveRecording', () => ({ stopActiveRecording: mockStopActiveRecording }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ stopAllScheduled: mockStopAllScheduled }));
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mockResetMidiState }));

import { executePlayheadSeek } from '../executePlayheadSeek';

describe('executePlayheadSeek', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resolves immediately when transport state is unavailable', async () => {
        mockGetTransportState.mockReturnValue(null);
        await executePlayheadSeek(8);
        expect(mockUpdateTransportState).not.toHaveBeenCalled();
    });

    it('seeks without stopping playback when not playing and not recording', async () => {
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: false });
        await executePlayheadSeek(16);
        expect(mockAdvanceEpoch).toHaveBeenCalledTimes(1);
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 16 });
        expect(mockStopScheduler).not.toHaveBeenCalled();
        expect(mockStartScheduler).not.toHaveBeenCalled();
    });

    it('stops and restarts the scheduler when playing and still playing after seek', async () => {
        // First call: before seek. Second call: after seek (inside finishSeek).
        mockGetTransportState.mockReturnValue({ isPlaying: true, isRecording: false });
        await executePlayheadSeek(16);
        expect(mockStopScheduler).toHaveBeenCalledTimes(1);
        expect(mockStopAllScheduled).toHaveBeenCalledTimes(1);
        expect(mockResetMidiState).toHaveBeenCalledTimes(1);
        expect(mockStartScheduler).toHaveBeenCalledTimes(1);
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 16 });
    });

    it('does not restart scheduler when playback stopped during seek', async () => {
        // isPlaying is true on first check, false on second check (inside finishSeek)
        mockGetTransportState
            .mockReturnValueOnce({ isPlaying: true, isRecording: false })
            .mockReturnValueOnce({ isPlaying: false, isRecording: false });
        await executePlayheadSeek(16);
        expect(mockStopScheduler).toHaveBeenCalledTimes(1);
        expect(mockStartScheduler).not.toHaveBeenCalled();
    });

    it('flushes recording before seeking when recording is active', async () => {
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: true });
        await executePlayheadSeek(8);
        expect(mockStopActiveRecording).toHaveBeenCalledTimes(1);
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 8 });
    });

    it('still seeks even when recording teardown fails', async () => {
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: true });
        mockStopActiveRecording.mockRejectedValueOnce(new Error('flush failed'));
        await expect(executePlayheadSeek(8)).rejects.toThrow('flush failed');
        // The seek still happened
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 8 });
    });

    it('clamps negative beats to zero', async () => {
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: false });
        await executePlayheadSeek(-5);
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 0 });
    });
});
