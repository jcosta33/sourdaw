import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled, stopNativeLiveGraphSession } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../../playheadScheduler/stopPlayheadScheduler';
import { pausePlayback } from '../pausePlayback';
import { stopActiveRecording } from '../stopActiveRecording';

const loggerMock = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
    stopAllScheduled: vi.fn(),
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    resetMidiState: vi.fn(),
    adaptGrooveTemplateForConsumer: vi.fn(),
    getGrooveTemplate: vi.fn(),
    getScopedGrooveAssignment: vi.fn(),
    getScopedGrooveConsumerId: vi.fn(),
    getStraightGrooveTemplateId: vi.fn(),
    restoreGrooveAssignment: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    yeastPanic: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('../../../stores/playheadPositionRef', () => ({
    playheadPositionRef: { current: 0 },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: loggerMock }));

describe('pausePlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopActiveRecording).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(yeastPanic).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(stopNativeLiveGraphSession).mockClear();
        vi.mocked(stopNativeLiveGraphSession).mockResolvedValue({ outcome: 'declined', reason: 'no session' });
        loggerMock.error.mockClear();
        loggerMock.warn.mockClear();
        playheadPositionRef.current = 0;
    });

    it('parks the native engine at the beat the pause landed on', () => {
        // Pause is a halt without a locate: the engine parks where the transport
        // stopped, which during playback is the live `playheadPositionRef` and
        // never the store's `playheadPosition` (still the beat play began at).
        // Beat 42 at 120 BPM is 21 seconds on the engine's clock.
        const liveState = { ...defaultTransportState, isPlaying: true, playheadPosition: 0 };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        playheadPositionRef.current = 42;

        pausePlayback();

        expect(stopNativeLiveGraphSession).toHaveBeenCalledWith({ positionSeconds: 21 });
    });

    it('parks the engine on the gesture, not behind the recording flush', () => {
        // The session serialises its commands in arrival order, so a play landing
        // during the flush must queue behind this park. Deferring the park into
        // the flush continuation would let that play be overtaken and leave the
        // engine parked under a rolling transport.
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        vi.mocked(stopActiveRecording).mockReturnValueOnce(new Promise<void>(() => undefined));

        pausePlayback();

        expect(stopNativeLiveGraphSession).toHaveBeenCalledTimes(1);
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
    });

    it('pauses the transport whatever the native engine answers, because it is not the audible path', async () => {
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        vi.mocked(stopNativeLiveGraphSession).mockRejectedValue(new Error('addon crashed'));

        pausePlayback();

        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
        // The rejection is caught and reported rather than left unhandled: an
        // addon that cannot answer must not take the pause down with it.
        await vi.waitFor(() => {
            expect(loggerMock.warn).toHaveBeenCalledWith(
                expect.objectContaining({ message: expect.stringContaining('failed to park') })
            );
        });
    });

    it('persists the live playhead position into the store so resume restarts from the pause point', async () => {
        // During playback the scheduler writes only playheadPositionRef; the
        // store still holds the position where playback started (0). Pause must
        // commit the live position or the next play resumes from the old start.
        const liveState = { ...defaultTransportState, isPlaying: true, playheadPosition: 0 };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        playheadPositionRef.current = 42;

        pausePlayback();

        expect(updateTransportState).toHaveBeenCalledWith({
            isPlaying: false,
            isRecording: false,
            playheadPosition: 42,
        });
        expect(liveState.playheadPosition).toBe(42);
        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
    });

    it('should pause transport and tear down scheduling when state exists', async () => {
        // Model the real flow: pausePlayback flips isPlaying:false via
        // updateTransportState, so the deferred continuation observes it.
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });

        pausePlayback();

        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(yeastPanic).toHaveBeenCalledWith(48000);
        expect(updateTransportState).toHaveBeenCalledWith({
            isPlaying: false,
            isRecording: false,
            playheadPosition: 0,
        });
    });

    it('should wait for recording teardown before stopping the scheduler', async () => {
        const order: string[] = [];
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
            if (patch.isPlaying === false) {
                order.push('isPlaying:false');
            }
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });
        let finishRecordingStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingStop = resolve;
            })
        );

        pausePlayback();

        // The paused state must be committed before the recording flush and
        // scheduler teardown: a queued tick reads transportStore.isPlaying first.
        expect(order).toEqual(['isPlaying:false']);
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
        expect(order).toContain('stopPlayheadScheduler');
        expect(order.indexOf('isPlaying:false')).toBeLessThan(order.indexOf('stopPlayheadScheduler'));
    });

    it('should cancel a pending count-in via stopActiveRecording even when not recording', async () => {
        // During count-in isRecording is still false; the count-in timer must
        // still be cleared so it cannot fire beginActualRecording after pause.
        const liveState = { ...defaultTransportState, isPlaying: true, isRecording: false };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });

        pausePlayback();

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
    });

    it('should report a recording teardown rejection and still finish pausing', async () => {
        const recordingError = new Error('recording flush failed');
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        vi.mocked(stopActiveRecording).mockRejectedValueOnce(recordingError);

        pausePlayback();

        await vi.waitFor(() => expect(resetMidiState).toHaveBeenCalled());

        expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ cause: recordingError }));
        expect(stopPlayheadScheduler).toHaveBeenCalledOnce();
        expect(stopAllScheduled).toHaveBeenCalledOnce();
    });

    it('should not tear down the scheduler when playback is restarted during the recording flush', async () => {
        // A play pressed during the flush window starts a fresh scheduler
        // session; startPlayback's re-entry guard only checks isPlaying, so the
        // stale pause continuation must not tear the new session down.
        const liveState = { ...defaultTransportState, isPlaying: true };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation((patch) => {
            Object.assign(liveState, patch);
        });
        let finishRecordingStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingStop = resolve;
            })
        );

        pausePlayback();

        // Restart: a fresh startPlayback flips isPlaying back to true while the
        // recording flush is still pending.
        liveState.isPlaying = true;

        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(stopAllScheduled).not.toHaveBeenCalled();
        expect(resetMidiState).not.toHaveBeenCalled();
        expect(yeastPanic).not.toHaveBeenCalled();
    });

    it('should no-op when transport state is missing', () => {
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(update).not.toHaveBeenCalled();
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(stopActiveRecording).not.toHaveBeenCalled();
    });
});
