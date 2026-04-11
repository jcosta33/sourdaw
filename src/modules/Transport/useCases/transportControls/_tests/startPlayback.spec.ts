import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startPlayback } from '../startPlayback';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { getTransportState } from '#/modules/Transport/repositories/transport/getTransportState';
import { updateTransportState } from '#/modules/Transport/repositories/transport/updateTransportState';
import { resumeEngine } from '#/modules/AudioEngine/useCases';
import { startPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';

vi.mock('#/modules/Transport/repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('#/modules/Transport/repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        resumeEngine: vi.fn(),
    };
});
vi.mock('#/modules/Transport/useCases/playheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('#/modules/Transport/useCases/ensureTrackStrips', () => ({
    ensureTrackStrips: vi.fn(),
}));

describe('startPlayback', () => {
    beforeEach(() => {
        playheadPositionRef.current = 0;
        vi.mocked(getTransportState).mockClear();
        vi.mocked(updateTransportState).mockClear();
        vi.mocked(resumeEngine).mockClear();
        vi.mocked(startPlayheadScheduler).mockClear();
        vi.mocked(ensureTrackStrips).mockClear();
    });

    it('should resume engine and mark playing when state exists', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue({
            ...defaultTransportState,
            isPlaying: false,
            playheadPosition: 8,
            preRollEnabled: false,
        });
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).toHaveBeenCalled();
        expect(ensureTrackStrips).toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith({ isPlaying: true, playheadPosition: 8 });
        expect(playheadPositionRef.current).toBe(8);
        expect(startPlayheadScheduler).toHaveBeenCalled();
    });

    it('should not start when transport state is missing', () => {
        const update = vi.fn();
        vi.mocked(getTransportState).mockReturnValue(null as any);
        vi.mocked(updateTransportState).mockImplementation(update);

        startPlayback();

        expect(resumeEngine).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
    });
});
