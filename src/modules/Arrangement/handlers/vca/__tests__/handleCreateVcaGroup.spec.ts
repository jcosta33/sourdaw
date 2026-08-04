import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleCreateVcaGroup } from '../handleCreateVcaGroup';

const mocks = vi.hoisted(() => ({
    createVcaGroup: vi.fn(),
    toVcaGainExecutionResult: vi.fn(),
}));

vi.mock('../../../useCases/vca/createVcaGroup', () => ({
    createVcaGroup: mocks.createVcaGroup,
}));

vi.mock('../toVcaGainExecutionResult', () => ({
    toVcaGainExecutionResult: mocks.toVcaGainExecutionResult,
}));

describe('handleCreateVcaGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes createVcaGroup with payload', () => {
        const action: Extract<AppAction, { type: 'createVcaGroup' }> = {
            type: 'createVcaGroup',
            payload: { name: 'Drums VCA', trackIds: ['t1', 't2'] },
        };

        void handleCreateVcaGroup.execute(action);

        expect(mocks.createVcaGroup).toHaveBeenCalledWith('Drums VCA', ['t1', 't2'], expect.stringMatching(/^vca-/));
        expect(mocks.toVcaGainExecutionResult).toHaveBeenCalledWith({
            groupIds: [action.payload.vcaGroupId],
            trackIds: ['t1', 't2'],
            status: 'written',
        });
    });

    it('is undoable', () => {
        expect(handleCreateVcaGroup.undoable).toBe(true);
    });
});
