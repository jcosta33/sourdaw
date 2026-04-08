import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { seekPlayhead } from './seekPlayhead';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { startPlayheadScheduler, stopPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { stopAllScheduled } from '#/modules/AudioEngine/useCases/scheduling';
import { resetMidiState } from '#/modules/AudioEngine/useCases/webMidiInput';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';

vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
    stopPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/scheduling', () => ({
    stopAllScheduled: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/webMidiInput', () => ({
    resetMidiState: vi.fn(),
}));

describe('seekPlayhead', () => {
    beforeEach(() => {
        vi.mocked(stopPlayheadScheduler).mockClear();
        vi.mocked(startPlayheadScheduler).mockClear();
        vi.mocked(stopAllScheduled).mockClear();
        vi.mocked(resetMidiState).mockClear();
        playheadPositionRef.current = 0;
    });

    it('should clamp beat and update transport when stopped', () => {
        const update = vi.fn();
        injectDependencies(seekPlayhead, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: false,
                playheadPosition: 4,
            })),
            updateTransportState: update,
        });

        seekPlayhead(10);

        expect(stopPlayheadScheduler).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ playheadPosition: 10 });
        expect(playheadPositionRef.current).toBe(10);
        expect(startPlayheadScheduler).not.toHaveBeenCalled();
    });

    it('should restart scheduler when seeking while playing', () => {
        const update = vi.fn();
        injectDependencies(seekPlayhead, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: true,
                playheadPosition: 1,
            })),
            updateTransportState: update,
        });

        seekPlayhead(3);

        expect(stopPlayheadScheduler).toHaveBeenCalled();
        expect(stopAllScheduled).toHaveBeenCalled();
        expect(resetMidiState).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ playheadPosition: 3 });
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });
});
