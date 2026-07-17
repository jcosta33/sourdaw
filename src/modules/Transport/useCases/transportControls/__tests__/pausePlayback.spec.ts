import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled, resetMidiState } from '#/modules/AudioEngine/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { stopPlayheadScheduler } from '../../playheadScheduler';
import { pausePlayback } from '../pausePlayback';
import { stopActiveRecording } from '../stopActiveRecording';

const loggerMock = vi.hoisted(() => ({
    error: vi.fn(),
}));

vi.mock('../../playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
    stopAllScheduled: vi.fn(),
    resetMidiState: vi.fn(),
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
        loggerMock.error.mockClear();
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
        expect(updateTransportState).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
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
