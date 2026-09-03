import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { startPlayheadScheduler } from '../../playheadScheduler/startPlayheadScheduler';
import { stopPlayheadScheduler } from '../../playheadScheduler/stopPlayheadScheduler';
import { seekPlayhead } from '../seekPlayhead';
import { stopActiveRecording } from '../stopActiveRecording';

const loggerMock = vi.hoisted(() => ({
    error: vi.fn(),
}));

vi.mock('../../playheadScheduler/startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
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
vi.mock('#/infra/logger/appLogger', () => ({ logger: loggerMock }));

describe('seekPlayhead', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(startPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(yeastPanic).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(stopActiveRecording).mockClear();
        loggerMock.error.mockClear();
        playheadPositionRef.current = 0;
    });

    it('should clamp beat and update transport when stopped', () => {
        const update = vi.fn();
        const beforeSeekEpoch = schedulerSession.discontinuityEpoch;
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 4,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        seekPlayhead(10);

        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(stopActiveRecording).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ playheadPosition: 10 });
        expect(playheadPositionRef.current).toBe(10);
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
        expect(schedulerSession.discontinuityEpoch).toBeGreaterThan(beforeSeekEpoch);
    });

    it('should restart scheduler when seeking while playing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            playheadPosition: 1,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        seekPlayhead(3);

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(yeastPanic).toHaveBeenCalledWith(48000);
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('should wait for an in-progress recording before tearing down the scheduler', async () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            playheadPosition: 1,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        const order: string[] = [];
        let finishRecordingStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                order.push('stopActiveRecording');
                finishRecordingStop = resolve;
            })
        );
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });

        seekPlayhead(3);

        // The recording must be committed while the engine is still live, i.e.
        // before the scheduler (and its automation/audio teardown) is stopped.
        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['stopActiveRecording']);
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
        expect(order).toEqual(['stopActiveRecording', 'stopPlayheadScheduler']);
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('should commit an in-progress recording even when seeking while stopped', async () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            isRecording: true,
            playheadPosition: 1,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        seekPlayhead(5);

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        // Not playing, so the scheduler is neither stopped nor restarted.
        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ playheadPosition: 5 }));
        expect(update).toHaveBeenCalledWith({ playheadPosition: 5 });
    });

    it('should report a recording teardown rejection and still complete the seek', async () => {
        const update = vi.fn();
        const recordingError = new Error('recording flush failed');
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            playheadPosition: 1,
        });
        vi.mocked(updateTransportState).mockImplementation(update);
        vi.mocked(stopActiveRecording).mockRejectedValueOnce(recordingError);

        seekPlayhead(3);

        await vi.waitFor(() => expect(startPlayheadScheduler).toHaveBeenCalled());

        expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ cause: recordingError }));
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
    });

    it('should not restart the scheduler when playback is stopped during the recording flush', async () => {
        // wasPlaying is captured before the stopActiveRecording await. If a stop
        // (or pause) lands during the flush window, the deferred finishSeek must
        // not resurrect the scheduler for a transport that is no longer playing.
        const update = vi.fn();
        const liveState = { ...defaultTransportState, isPlaying: true, isRecording: true, playheadPosition: 1 };
        vi.mocked(getTransportState).mockReturnValue(liveState);
        vi.mocked(updateTransportState).mockImplementation(update);

        let finishRecordingStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingStop = resolve;
            })
        );

        seekPlayhead(3);

        // A stop lands during the recording flush window.
        liveState.isPlaying = false;

        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await vi.waitFor(() => expect(update).toHaveBeenCalledWith({ playheadPosition: 3 }));

        // Position is still committed, but the scheduler is not restarted.
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
    });

    it('should panic Yeast even when seeking while already stopped', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
        });

        seekPlayhead(5);

        expect(yeastPanic).toHaveBeenCalledWith(48000);
    });
});
