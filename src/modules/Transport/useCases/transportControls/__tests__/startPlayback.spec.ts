import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resumeEngine } from '#/modules/AudioEngine/useCases/engineAccess/resumeEngine';

import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { updateTransportState } from '../../../repositories/transport/updateTransportState';
import { playheadPositionRef } from '../../../stores/playheadPositionRef';
import { ensureTrackStrips } from '../../ensureTrackStrips';
import { startPlayheadScheduler } from '../../playheadScheduler';
import { startPlayback } from '../startPlayback';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));
vi.mock('../../../repositories/transport/updateTransportState', () => ({
    updateTransportState: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases/engineAccess/resumeEngine', () => ({
    resumeEngine: vi.fn(),
}));
vi.mock('../../playheadScheduler', () => ({
    startPlayheadScheduler: vi.fn(),
}));
vi.mock('../../ensureTrackStrips', () => ({
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
