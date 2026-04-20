import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleSetVcaGain } from '../handleSetVcaGain';

const mocks = vi.hoisted(() => ({
    setVcaGain: vi.fn(),
}));

vi.mock('../../../useCases/vca/setVcaGain', () => ({
    setVcaGain: mocks.setVcaGain,
}));

describe('handleSetVcaGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes setVcaGain with payload', () => {
        handleSetVcaGain.execute({
            type: 'setVcaGain',
            payload: { vcaGroupId: 'vca1', gain: 0.8 },
        });

        expect(mocks.setVcaGain).toHaveBeenCalledWith('vca1', 0.8);
    });

    it('is undoable', () => {
        expect(handleSetVcaGain.undoable).toBe(true);
    });
});
