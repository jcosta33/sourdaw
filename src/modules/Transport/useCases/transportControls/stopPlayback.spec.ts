import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { stopPlayback } from './stopPlayback';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling/stopAllScheduled';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput/resetMidiState';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';

vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling/stopAllScheduled', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput/resetMidiState', () => ({
    resetMidiState: vi.fn(),
}));

describe('stopPlayback', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        playheadPositionRef.current = 0;
    });

    it('should stop playback and reset playhead when no loop region', () => {
        const update = vi.fn();
        injectDependencies(stopPlayback, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: true,
                loopStart: 0,
                loopEnd: 0,
                playheadPosition: 5,
            })),
            updateTransportState: update,
        });

        stopPlayback();

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 0 });
        expect(playheadPositionRef.current).toBe(0);
    });

    it('should jump playhead to loop start when a loop is defined', () => {
        const update = vi.fn();
        injectDependencies(stopPlayback, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: true,
                loopStart: 4,
                loopEnd: 8,
                playheadPosition: 6,
            })),
            updateTransportState: update,
        });

        stopPlayback();

        expect(update).toHaveBeenCalledWith({ isPlaying: false, isRecording: false, playheadPosition: 4 });
        expect(playheadPositionRef.current).toBe(4);
    });
});
