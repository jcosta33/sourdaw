import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type VcaGroup } from '../../../stores/vcaGroupStore';
import { handleSetVcaGain } from '../handleSetVcaGain';

const mocks = vi.hoisted(() => ({
    getVcaGroupsState: vi.fn<() => VcaGroup[]>(),
    setVcaGain: vi.fn<(id: string, gain: number) => boolean>(),
}));

vi.mock('../../../stores/vcaGroupStore', () => ({ getVcaGroupsState: mocks.getVcaGroupsState }));
vi.mock('../../../useCases/vca/setVcaGain', () => ({
    setVcaGain: mocks.setVcaGain,
}));

describe('handleSetVcaGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getVcaGroupsState.mockReturnValue([{ id: 'vca1', name: 'VCA', gain: 1, muted: false, trackIds: [] }]);
        mocks.setVcaGain.mockReturnValue(true);
    });

    it('executes setVcaGain with payload', () => {
        const result = handleSetVcaGain.execute({
            type: 'setVcaGain',
            payload: { vcaGroupId: 'vca1', gain: 0.8 },
        });

        expect(mocks.setVcaGain).toHaveBeenCalledWith('vca1', 0.8);
        expect(result).toMatchObject({ status: 'written' });
    });

    it('does not write when the group is missing', () => {
        mocks.getVcaGroupsState.mockReturnValue([]);

        expect(handleSetVcaGain.execute({ type: 'setVcaGain', payload: { vcaGroupId: 'vca1', gain: 0.8 } })).toEqual({
            status: 'no-write',
        });
        expect(mocks.setVcaGain).not.toHaveBeenCalled();
    });

    it('is undoable', () => {
        expect(handleSetVcaGain.undoable).toBe(true);
    });
});
