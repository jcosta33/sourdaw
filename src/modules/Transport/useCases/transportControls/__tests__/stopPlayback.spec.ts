import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../../stopPlayheadScheduler';
import { stopActiveRecording } from '../stopActiveRecording';
import { stopPlayback } from '../stopPlayback';

vi.mock('../../stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
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
vi.mock('../stopActiveRecording', () => ({
    stopActiveRecording: vi.fn(),
}));

describe('stopPlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(yeastPanic).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(stopActiveRecording).mockClear();
        playheadPositionRef.current = 0;
    });

    it('should stop playback and reset playhead when no loop region', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            loopStart: 0,
            loopEnd: 0,
            playheadPosition: 5,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        stopPlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(yeastPanic).toHaveBeenCalledWith(48000);
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 0 });
        expect(playheadPositionRef.current).toBe(0);
    });

    it('should finalise active recording before halting the transport', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
        });
        const order: string[] = [];
        vi.mocked(stopActiveRecording).mockImplementation(() => {
            order.push('stopActiveRecording');
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });

        stopPlayback();

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['stopActiveRecording', 'stopPlayheadScheduler']);
    });

    it('waits for recorder teardown even when transport is no longer recording', async () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
        });
        let finishRecordingStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingStop = resolve;
            })
        );
        let settled = false;

        const stopping = stopPlayback().then(() => {
            settled = true;
        });
        await Promise.resolve();

        expect(stopActiveRecording).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await stopping;
        expect(settled).toBe(true);
    });

    it('should jump playhead to loop start when a loop is defined', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 6,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        stopPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 4 });
        expect(playheadPositionRef.current).toBe(4);
    });
});
