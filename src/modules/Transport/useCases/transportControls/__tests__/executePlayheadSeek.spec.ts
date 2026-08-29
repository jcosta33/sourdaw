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
    mockReposition,
    mockLogger,
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
    mockReposition: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
    mockLogger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
vi.mock('#/modules/AudioEngine/useCases', () => ({
    stopAllScheduled: mockStopAllScheduled,
    repositionNativeLiveGraphSession: mockReposition,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mockResetMidiState }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

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

    it('locates the native engine at the beat the seek targeted', async () => {
        // #3101: without this the scheduler restarts at the target while the
        // engine keeps rolling from where it was, and the two transports play
        // different parts of the arrangement. Beat 42 at 120 BPM is 21 seconds
        // on the engine's clock.
        mockGetTransportState.mockReturnValue({ isPlaying: true, isRecording: false, tempo: 120 });

        await executePlayheadSeek(42);

        expect(mockReposition).toHaveBeenCalledExactlyOnceWith({ positionSeconds: 21 });
    });

    it('sends the engine nothing when the transport is not playing', async () => {
        // A parked engine renders no frame and its playhead feed is closed, so
        // nothing hears or reads where it stands, and the next play re-sends the
        // position. Writing here would spend a bridge round trip per pointer
        // frame of a stopped drag-scrub to move a transport nobody is observing.
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: false, tempo: 120 });

        await executePlayheadSeek(42);

        expect(mockReposition).not.toHaveBeenCalled();
    });

    it('locates the engine on the gesture, not behind the recording flush', async () => {
        // The session applies its commands in arrival order, so a stop landing
        // during the flush must queue behind this locate and win. Deferred into
        // the flush continuation, the locate would instead be admitted after the
        // stop and set a parked engine rolling again at the seek target.
        mockGetTransportState.mockReturnValue({ isPlaying: true, isRecording: true, tempo: 120 });
        mockStopActiveRecording.mockReturnValueOnce(new Promise<void>(() => undefined));

        void executePlayheadSeek(42);

        expect(mockReposition).toHaveBeenCalledExactlyOnceWith({ positionSeconds: 21 });
        expect(mockStopScheduler).not.toHaveBeenCalled();
    });

    it('seeks the transport whatever the native engine answers, because it is not the audible path', async () => {
        mockGetTransportState.mockReturnValue({ isPlaying: true, isRecording: false, tempo: 120 });
        mockReposition.mockRejectedValueOnce(new Error('addon crashed'));

        await executePlayheadSeek(42);

        // The rejection is caught and reported rather than left unhandled or
        // surfaced as a failed seek: an addon that cannot answer must not take
        // the gesture down with it.
        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 42 });
        expect(mockStartScheduler).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => {
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('failed to reposition') })
            );
        });
    });
});
