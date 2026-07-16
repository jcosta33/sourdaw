import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';
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
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
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
        const update = vi.fn<typeof updateTransportState>();
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(yeastPanic).toHaveBeenCalledWith(48000);
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false });
    });

    it('should wait for recording teardown before stopping the scheduler', async () => {
        const order: string[] = [];
        const update = vi.fn<typeof updateTransportState>().mockImplementation((patch) => {
            if (patch.isPlaying === false) {
                order.push('isPlaying:false');
            }
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);
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
        const update = vi.fn<typeof updateTransportState>();
        // During count-in isRecording is still false; the count-in timer must
        // still be cleared so it cannot fire beginActualRecording after pause.
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        pausePlayback();

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(stopPlayheadScheduler).toHaveBeenCalled());
    });

    it('should report a recording teardown rejection and still finish pausing', async () => {
        const update = vi.fn<typeof updateTransportState>();
        const recordingError = new Error('recording flush failed');
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, isPlaying: true });
        vi.mocked(updateTransportState).mockImplementation(update);
        vi.mocked(stopActiveRecording).mockRejectedValueOnce(recordingError);

        pausePlayback();

        await vi.waitFor(() => expect(resetMidiState).toHaveBeenCalled());

        expect(loggerMock.error).toHaveBeenCalledWith(expect.objectContaining({ cause: recordingError }));
        expect(stopPlayheadScheduler).toHaveBeenCalledOnce();
        expect(stopAllScheduled).toHaveBeenCalledOnce();
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
