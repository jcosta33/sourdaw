import { describe, it, expect, vi, beforeEach } from 'vitest';

import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { stopPlayheadScheduler } from '../../playheadScheduler';
import { stopPlayback } from '../stopPlayback';
import { toggleRecording } from '../toggleRecording';

vi.mock('../../playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));
vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('../toggleRecording', () => ({
    toggleRecording: vi.fn(),
}));

describe('stopPlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(toggleRecording).mockClear();
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
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 0 });
        expect(playheadPositionRef.current).toBe(0);
    });

    it('should finalise active recording before halting the transport', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: true,
        });

        stopPlayback();

        expect(toggleRecording).toHaveBeenCalledTimes(1);
    });

    it('should not call toggleRecording when not recording', () => {
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: true,
            isRecording: false,
        });

        stopPlayback();

        expect(toggleRecording).not.toHaveBeenCalled();
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
