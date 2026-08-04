import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases';
import { resetMidiState } from '#/modules/MIDI/useCases';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../../playheadScheduler/stopPlayheadScheduler';
import { stopActiveRecording } from '../stopActiveRecording';
import { stopPlayback } from '../stopPlayback';

vi.mock('../../playheadScheduler/stopPlayheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: vi.fn(() => ({ currentTime: 1, sampleRate: 48000 })),
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
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

        void stopPlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(yeastPanic).toHaveBeenCalledWith(48000);
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 0 });
        expect(playheadPositionRef.current).toBe(0);
    });

    it('should begin recording teardown before Yeast and engine teardown', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
        });
        const order: string[] = [];
        vi.mocked(stopActiveRecording).mockImplementation(() => {
            order.push('stopActiveRecording');
            return Promise.resolve();
        });
        vi.mocked(yeastPanic).mockImplementation(() => {
            order.push('yeastPanic');
            return Promise.resolve();
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });

        void stopPlayback();

        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['stopActiveRecording', 'yeastPanic', 'stopPlayheadScheduler']);
    });

    it('waits for both recorder and Yeast teardown after applying Stop synchronously', async () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
        });
        let finishRecordingStop: (() => void) | undefined;
        let finishYeastStop: (() => void) | undefined;
        vi.mocked(stopActiveRecording).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishRecordingStop = resolve;
            })
        );
        vi.mocked(yeastPanic).mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishYeastStop = resolve;
            })
        );
        let settled = false;

        const stopping = stopPlayback().then(() => {
            settled = true;
            return undefined;
        });
        expect(updateTransportState).toHaveBeenCalledWith({
            isPlaying: false,
            isRecording: false,
            playheadPosition: 0,
        });
        await Promise.resolve();

        expect(stopActiveRecording).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
        const finish = finishRecordingStop;
        if (!finish) {
            throw new Error('Expected recorder teardown to be pending');
        }
        finish();
        await Promise.resolve();
        expect(settled).toBe(false);
        const finishYeast = finishYeastStop;
        if (!finishYeast) {
            throw new Error('Expected Yeast teardown to be pending');
        }
        finishYeast();
        await stopping;
        expect(settled).toBe(true);
    });

    it('rejects teardown completion without rolling back the synchronously applied Stop', async () => {
        const failure = new Error('recording flush failed');
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            playheadPosition: 5,
        });
        vi.mocked(stopActiveRecording).mockRejectedValueOnce(failure);

        const stopping = stopPlayback();

        expect(updateTransportState).toHaveBeenCalledWith({
            isPlaying: false,
            isRecording: false,
            playheadPosition: 0,
        });
        await expect(stopping).rejects.toBe(failure);
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

        void stopPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 4 });
        expect(playheadPositionRef.current).toBe(4);
    });

    it('returns the recording flush without touching transport when no transport state exists', async () => {
        // The transport store is the public read contract; an absent snapshot
        // means there is nothing to halt. The recording flush (count-in cancel +
        // active recording teardown) must still run.
        vi.mocked(getTransportState).mockReturnValue(null);
        vi.mocked(stopActiveRecording).mockResolvedValue(undefined);

        const result = stopPlayback();

        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(stopAllScheduled).not.toHaveBeenCalled();
        expect(resetMidiState).not.toHaveBeenCalled();
        expect(updateTransportState).not.toHaveBeenCalled();
        await expect(result).resolves.toBeUndefined();
    });

    it('double-stops an idle playhead at loop start back to zero (DAW standard UX)', () => {
        // Already stopped (isPlaying:false) and sitting exactly at loopStart:
        // a second stop press jumps the playhead to 0.
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 4,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        void stopPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 0 });
        expect(playheadPositionRef.current).toBe(0);
    });

    it('keeps the playhead at loop start when stopped but playhead is not at loop start', () => {
        // Stopped, with a loop, but playhead is elsewhere: jump to loop start.
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 6,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        void stopPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 4 });
    });
});
