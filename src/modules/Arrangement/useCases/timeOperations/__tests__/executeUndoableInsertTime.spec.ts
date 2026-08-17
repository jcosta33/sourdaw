import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ insertTime: vi.fn(), prepareRestore: vi.fn() }));
vi.mock('../insertTime', () => ({ insertTime: mocks.insertTime }));
vi.mock('../prepareTimeOperationStateRestore', () => ({ prepareTimeOperationStateRestore: mocks.prepareRestore }));
import { executeUndoableInsertTime } from '../executeUndoableInsertTime';

const inversePlan = {
    version: 1,
    scope: 'global',
    local: { version: 1, expected: 'inserted', replacement: 'before' },
    automation: null,
    midi: null,
    timelineMap: null,
    clipSatellites: null,
};

describe('executeUndoableInsertTime', () => {
    it('restores and redoes the exact captured insert snapshot', () => {
        mocks.insertTime.mockReturnValue({
            status: 'applied',
            hasChanges: true,
            replayPlan: { version: 1 },
            inversePlan,
        });
        mocks.prepareRestore.mockReturnValue({ status: 'ready', hasChanges: true, apply: vi.fn(() => true) });
        const transaction = executeUndoableInsertTime(4, 2);

        transaction?.undo();
        expect(mocks.prepareRestore).toHaveBeenLastCalledWith(inversePlan);
        transaction?.redo();
        expect(mocks.prepareRestore).toHaveBeenLastCalledWith({
            ...inversePlan,
            local: { version: 1, expected: 'before', replacement: 'inserted' },
        });
    });
});
