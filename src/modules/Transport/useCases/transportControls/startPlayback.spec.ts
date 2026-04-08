import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startPlayback } from './startPlayback';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { resumeEngine } from '#/modules/AudioEngine/useCases/engineAccess';
import { startPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';

vi.mock('#/modules/AudioEngine/useCases/engineAccess', () => ({
    resumeEngine: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases/ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));

describe('startPlayback', () => {
    beforeEach(() => {
        vi.mocked(resumeEngine).mockClear();
        vi.mocked(ensureTrackStrips).mockClear();
        vi.mocked(startPlayheadScheduler).mockClear();
        playheadPositionRef.current = 0;
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn();
        injectDependencies(startPlayback, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: false,
                playheadPosition: 8,
                preRollEnabled: false,
            })),
            updateTransportState: update,
        });

        startPlayback();

        expect(resumeEngine).toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 8 });
        expect(playheadPositionRef.current).toBe(8);
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('should not start when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(startPlayback, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});
