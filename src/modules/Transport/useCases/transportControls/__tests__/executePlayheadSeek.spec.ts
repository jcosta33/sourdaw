import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioEngine } from '#/modules/AudioEngine/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { playheadWrapCountRef } from '../../../stores/playheadWrapCountRef';
import { transportStore } from '../../../stores/transportStore';
import { claimSchedulerSession } from '../../playheadScheduler/claimSchedulerSession';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { executePlayheadSeek } from '../executePlayheadSeek';
import { recordingLifecycle } from '../recordingLifecycle';
import { startPlayback } from '../startPlayback';
import { stopPlayback } from '../stopPlayback';
import { toggleRecording } from '../toggleRecording';

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
    mockSetTransportInfo,
    mockStartNativeSession,
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
    mockSetTransportInfo: vi.fn(),
    mockStartNativeSession: vi.fn(() => Promise.resolve()),
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
vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: vi.fn(() => ({ acceptsRecording: true })),
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(() => ({ tracks: [{ id: 'record-track', kind: 'audio', armed: true }] })),
    startRecording: vi.fn(() => []),
    discardRecording: vi.fn(),
    commitRecording: vi.fn(),
}));
vi.mock('../../ensureTrackStrips', () => ({ ensureTrackStrips: vi.fn() }));
vi.mock('../startNativeSessionAtBeat', () => ({
    startNativeSessionAtBeat: mockStartNativeSession,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('../panicYeastRuntime', () => ({ panicYeastRuntime: mockPanicYeast }));
vi.mock('../stopActiveRecording', () => ({ stopActiveRecording: mockStopActiveRecording }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        setTransportInfo: mockSetTransportInfo,
    },
    cacheAudioBuffer: vi.fn(() => 'recorded-audio-buffer'),
    scheduleClick: vi.fn(),
    stopAllScheduled: mockStopAllScheduled,
    stopAudioRecording: vi.fn(() => Promise.resolve()),
    resumeEngine: vi.fn(() => Promise.resolve()),
    startAudioRecording: vi.fn(() => Promise.resolve(true)),
    getCompensationDelay: vi.fn(() => 0),
    nativeLiveGraphSessionOffered: vi.fn(() => true),
    getAudioContext: vi.fn(() => ({ currentTime: 0 })),
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'probe' })),
    repositionNativeLiveGraphSession: mockReposition,
}));
vi.mock('#/modules/MIDI/useCases', () => ({ resetMidiState: mockResetMidiState }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

describe('executePlayheadSeek', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(audioEngine.setTransportInfo).mockClear();
        playheadWrapCountRef.current = 0;
    });

    it('publishes isPlaying: false and target position to audioEngine.setTransportInfo when seeking while stopped', async () => {
        mockGetTransportState.mockReturnValue({
            isPlaying: false,
            isRecording: false,
            tempo: 120,
            loopStart: 2,
            loopEnd: 10,
            isLooping: true,
        });

        await executePlayheadSeek(6);

        expect(audioEngine.setTransportInfo).toHaveBeenCalledWith(
            6,
            3, // 6 beats at 120 BPM = 3 seconds
            120,
            false,
            2,
            10,
            true
        );
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

    it('cancels an armed count-in before seeking even though recording has not engaged', async () => {
        // During count-in `isRecording` is still false, so the recording gate
        // alone would skip the teardown and leave the armed wake holding the
        // beat the count-in counted to. Pause and stop cancel the same trap
        // through `stopActiveRecording`; the seek must route through it too.
        vi.useFakeTimers();
        try {
            recordingLifecycle.setCountInTimerId(setTimeout(() => undefined, 2000));
            mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: false });

            await executePlayheadSeek(32);

            expect(mockStopActiveRecording).toHaveBeenCalledTimes(1);
            expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 32 });
        } finally {
            recordingLifecycle.setCountInTimerId(null);
            vi.useRealTimers();
        }
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

    it('drops the dead roll wrap count beside the parked seek epoch', async () => {
        // The parked epoch is the position the next capture inverts from; the
        // dead roll's wraps must not survive beside it, and no scheduler
        // restart exists here to reset them.
        mockGetTransportState.mockReturnValue({ isPlaying: false, isRecording: false });
        playheadWrapCountRef.current = 2;

        await executePlayheadSeek(16);

        expect(mockUpdateTransportState).toHaveBeenCalledExactlyOnceWith({ playheadPosition: 16 });
        expect(mockStartScheduler).not.toHaveBeenCalled();
        expect(playheadWrapCountRef.current).toBe(0);
    });

    it('drops the count beside the seek epoch when the playing seek restarts the scheduler', async () => {
        // The restart re-zeros beside its own clock anchor; the epoch write
        // leaves nothing stale in the synchronous stretch between the two.
        mockGetTransportState.mockReturnValue({ isPlaying: true, isRecording: false });
        playheadWrapCountRef.current = 2;

        await executePlayheadSeek(16);

        expect(mockStartScheduler).toHaveBeenCalledTimes(1);
        expect(playheadWrapCountRef.current).toBe(0);
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

function deferredFlush() {
    let resolveFlush!: () => void;
    let rejectFlush!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
        resolveFlush = resolve;
        rejectFlush = reject;
    });
    return { promise, resolve: resolveFlush, reject: rejectFlush };
}

describe('deferred seek scheduler ownership', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const actualRead = await vi.importActual<typeof import('../../../repositories/transport/getTransportState')>(
            '../../../repositories/transport/getTransportState'
        );
        const actualWrite = await vi.importActual<
            typeof import('../../../repositories/transport/updateTransportState')
        >('../../../repositories/transport/updateTransportState');
        mockGetTransportState.mockImplementation(actualRead.getTransportState);
        mockUpdateTransportState.mockImplementation(actualWrite.updateTransportState);
        transportStore.set({ ...defaultTransportState, isPlaying: true, isRecording: true, playheadPosition: 4 });
        playheadPositionRef.current = 4;
        schedulerSession.generation += 1;
        schedulerSession.worker = null;
        schedulerSession.discontinuityEpoch = 0;
        vi.stubGlobal(
            'Worker',
            class {
                postMessage = vi.fn();
                terminate = vi.fn();
            }
        );
        // Keep the scheduler's browser worker boundary controlled; generation
        // claims and the public Stop/Play orchestration remain production code.
        mockStartScheduler.mockImplementation(() => {
            claimSchedulerSession();
            schedulerSession.worker = new Worker('seek-ownership-probe');
        });
        mockStopScheduler.mockImplementation(() => {
            claimSchedulerSession();
            schedulerSession.worker?.terminate();
            schedulerSession.worker = null;
        });
        mockAdvanceEpoch.mockImplementation(() => {
            schedulerSession.discontinuityEpoch += 1;
        });
        mockStopActiveRecording.mockImplementation(() => {
            actualWrite.updateTransportState({ isRecording: false });
            return Promise.resolve();
        });
        mockStartScheduler();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        mockStartScheduler.mockReset();
        mockStopScheduler.mockReset();
        mockAdvanceEpoch.mockReset();
        mockStopActiveRecording.mockReset().mockResolvedValue(undefined);
        mockGetTransportState.mockReset();
        mockUpdateTransportState.mockReset();
    });

    it.each([
        { record: false, reject: false },
        { record: false, reject: true },
        { record: true, reject: false },
        { record: true, reject: true },
    ])('preserves a Stop-to-successor session (record=$record, reject=$reject)', async ({ record, reject }) => {
        const flush = deferredFlush();
        mockStopActiveRecording.mockReturnValueOnce(flush.promise);
        const seek = executePlayheadSeek(16);
        const failure = new Error('original flush failed');
        const outcome = seek.then(
            () => undefined,
            (error: unknown) => error
        );
        expect(mockReposition).toHaveBeenCalledExactlyOnceWith({ positionSeconds: 8 });
        expect(mockUpdateTransportState).not.toHaveBeenCalled();

        await stopPlayback();
        mockUpdateTransportState({ playheadPosition: 32 });
        if (record) {
            toggleRecording();
            await vi.waitFor(() => {
                expect(transportStore.value?.isRecording).toBe(true);
                expect(schedulerSession.worker).not.toBeNull();
            });
        } else {
            await startPlayback();
        }
        const successor = {
            worker: schedulerSession.worker,
            generation: schedulerSession.generation,
            epoch: schedulerSession.discontinuityEpoch,
            state: transportStore.value,
            beat: playheadPositionRef.current,
        };
        expect(successor.worker).not.toBeNull();
        expect(successor.state?.isRecording).toBe(record);
        vi.clearAllMocks();

        if (reject) {
            flush.reject(failure);
        } else {
            flush.resolve();
        }
        expect(await outcome).toBe(reject ? failure : undefined);

        expect(schedulerSession.worker).toBe(successor.worker);
        expect(schedulerSession.generation).toBe(successor.generation);
        expect(schedulerSession.discontinuityEpoch).toBe(successor.epoch);
        expect(transportStore.value).toBe(successor.state);
        expect(playheadPositionRef.current).toBe(successor.beat);
        expect(mockPanicYeast).not.toHaveBeenCalled();
        expect(mockStopAllScheduled).not.toHaveBeenCalled();
        expect(mockResetMidiState).not.toHaveBeenCalled();
        expect(mockUpdateTransportState).not.toHaveBeenCalled();
        expect(mockStartScheduler).not.toHaveBeenCalled();
        expect(mockSetTransportInfo).not.toHaveBeenCalled();
    });

    it('protects a successor claimed while its native start still holds the worker', async () => {
        const flush = deferredFlush();
        const nativeStart = deferredFlush();
        mockStopActiveRecording.mockReturnValueOnce(flush.promise);
        const seek = executePlayheadSeek(16);
        await stopPlayback();
        mockUpdateTransportState({ playheadPosition: 32 });
        mockStartNativeSession.mockReturnValueOnce(nativeStart.promise);
        const playback = startPlayback();
        const successorGeneration = schedulerSession.generation;
        expect(schedulerSession.worker).toBeNull();
        expect(playheadPositionRef.current).toBe(32);
        vi.clearAllMocks();

        flush.resolve();
        await seek;
        expect(schedulerSession.generation).toBe(successorGeneration);
        expect(playheadPositionRef.current).toBe(32);
        expect(mockStopScheduler).not.toHaveBeenCalled();
        expect(mockStartScheduler).not.toHaveBeenCalled();
        expect(mockUpdateTransportState).not.toHaveBeenCalled();
        nativeStart.resolve();
        await playback;
        expect(schedulerSession.worker).not.toBeNull();
        expect(playheadPositionRef.current).toBe(32);
    });

    it('finishes an unchanged owner after its recording flush', async () => {
        const flush = deferredFlush();
        mockStopActiveRecording.mockReturnValueOnce(flush.promise);
        const seek = executePlayheadSeek(16);
        expect(playheadPositionRef.current).toBe(4);
        const worker = schedulerSession.worker;
        flush.resolve();
        await seek;
        expect(playheadPositionRef.current).toBe(16);
        expect(transportStore.value?.playheadPosition).toBe(16);
        expect(schedulerSession.worker).not.toBe(worker);
    });

    it.each([false, true])('finishes a parked or paused seek (wasPlaying=%s)', async (wasPlaying) => {
        const flush = deferredFlush();
        mockStopActiveRecording.mockReturnValueOnce(flush.promise);
        mockUpdateTransportState({ isPlaying: wasPlaying });
        const seek = executePlayheadSeek(16);
        // A pause publishes its flag before its deferred scheduler teardown.
        mockUpdateTransportState({ isPlaying: false });
        flush.resolve();
        await seek;
        expect(playheadPositionRef.current).toBe(16);
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(mockStartScheduler).not.toHaveBeenCalled();
        expect(mockSetTransportInfo).toHaveBeenCalledWith(16, 8, 120, false, 0, 0, false);
    });

    it('commits a non-recording seek synchronously', async () => {
        mockUpdateTransportState({ isPlaying: false, isRecording: false });
        const seek = executePlayheadSeek(16);
        expect(playheadPositionRef.current).toBe(16);
        expect(transportStore.value?.playheadPosition).toBe(16);
        expect(mockStopActiveRecording).not.toHaveBeenCalled();
        await seek;
    });

    it('lets two deferred seeks from one owner finish in flush order', async () => {
        const firstFlush = deferredFlush();
        const secondFlush = deferredFlush();
        mockStopActiveRecording.mockReturnValueOnce(firstFlush.promise).mockReturnValueOnce(secondFlush.promise);
        const firstSeek = executePlayheadSeek(16);
        const secondSeek = executePlayheadSeek(24);
        firstFlush.resolve();
        await firstSeek;
        expect(playheadPositionRef.current).toBe(16);
        const firstWorker = schedulerSession.worker;
        secondFlush.resolve();
        await secondSeek;
        expect(playheadPositionRef.current).toBe(24);
        expect(transportStore.value?.playheadPosition).toBe(24);
        expect(schedulerSession.worker).not.toBe(firstWorker);
    });
});
