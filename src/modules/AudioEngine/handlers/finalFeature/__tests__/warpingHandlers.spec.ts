import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleEnableWarping } from '../handleEnableWarping';
import { handleSetWarpAlgorithm } from '../handleSetWarpAlgorithm';
import { handleSetWarpPitchShift } from '../handleSetWarpPitchShift';

const mocks = vi.hoisted(() => ({
    setWarpAlgorithm: vi.fn(),
    setPitchShift: vi.fn(),
}));

vi.mock('#/modules/ElasticAudio/useCases', () => ({
    setWarpAlgorithm: mocks.setWarpAlgorithm,
    setPitchShift: mocks.setPitchShift,
}));

describe('Warping Handlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps public repitch enablement singleton and undoable', () => {
        // Actual project writes, inverse replay and refusals belong to publicWarpActionsAuthority.integration.spec.ts.
        expect(handleEnableWarping.batchExecution).toBe('singleton');
        expect(handleEnableWarping.undoable).toBe(true);
    });

    it('handleSetWarpAlgorithm delegates to use case', () => {
        void handleSetWarpAlgorithm.execute({
            type: 'setWarpAlgorithm',
            payload: { clipId: 'c1', algorithm: 'complex' },
        });
        expect(mocks.setWarpAlgorithm).toHaveBeenCalledWith('c1', 'complex');
    });

    it('handleSetWarpPitchShift delegates to use case', () => {
        void handleSetWarpPitchShift.execute({ type: 'setWarpPitchShift', payload: { clipId: 'c1', semitones: 12 } });
        expect(mocks.setPitchShift).toHaveBeenCalledWith('c1', 12);
    });
});
