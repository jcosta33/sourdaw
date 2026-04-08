import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startPlayback } from './startPlayback';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn();
        const resumeEngine = vi.fn();
        const ensureTrackStrips = vi.fn();
        const startPlayheadScheduler = vi.fn();
        injectDependencies(startPlayback, {
            getTransportState: vi.fn(() => ({
                ...defaultTransportState,
                isPlaying: false,
                playheadPosition: 8,
                preRollEnabled: false,
            })),
            updateTransportState: update,
            resumeEngine,
            ensureTrackStrips,
            startPlayheadScheduler,
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
        const resumeEngine = vi.fn();
        const ensureTrackStrips = vi.fn();
        const startPlayheadScheduler = vi.fn();
        injectDependencies(startPlayback, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
            resumeEngine,
            ensureTrackStrips,
            startPlayheadScheduler,
        });

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});
