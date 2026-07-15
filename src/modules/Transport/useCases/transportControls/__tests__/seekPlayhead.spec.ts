import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';
import { yeastPanic } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { startPlayheadScheduler } from '../../startPlayheadScheduler';
import { stopPlayheadScheduler } from '../../stopPlayheadScheduler';
import { seekPlayhead } from '../seekPlayhead';
import { stopActiveRecording } from '../stopActiveRecording';

vi.mock('../../startPlayheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../stopPlayheadScheduler', () => ({
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
        playheadPositionRef.current = 0;
    });

    it('should clamp beat and update transport when stopped', () => {
        const update = vi.fn();
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

    it('should commit an in-progress recording before tearing down the scheduler', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
            playheadPosition: 1,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        const order: string[] = [];
        vi.mocked(stopActiveRecording).mockImplementation(() => {
            order.push('stopActiveRecording');
        });
        vi.mocked(stopPlayheadScheduler).mockImplementation(() => {
            order.push('stopPlayheadScheduler');
        });

        seekPlayhead(3);

        // The recording must be committed while the engine is still live, i.e.
        // before the scheduler (and its automation/audio teardown) is stopped.
        expect(stopActiveRecording).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['stopActiveRecording', 'stopPlayheadScheduler']);
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('should commit an in-progress recording even when seeking while stopped', () => {
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
        expect(update).toHaveBeenCalledWith({ playheadPosition: 5 });
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
