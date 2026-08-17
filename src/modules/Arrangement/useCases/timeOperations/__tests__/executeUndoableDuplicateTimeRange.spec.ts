import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ duplicateTimeRange: vi.fn(), prepareRestore: vi.fn() }));
vi.mock('../duplicateTimeRange', () => ({ duplicateTimeRange: mocks.duplicateTimeRange }));
vi.mock('../prepareTimeOperationStateRestore', () => ({ prepareTimeOperationStateRestore: mocks.prepareRestore }));
import { executeUndoableDuplicateTimeRange } from '../executeUndoableDuplicateTimeRange';

const inversePlan = {
    version: 1,
    scope: 'global',
    local: { version: 1, expected: 'duplicate', replacement: 'before' },
    automation: null,
    midi: null,
    timelineMap: null,
    clipSatellites: null,
};

describe('executeUndoableDuplicateTimeRange', () => {
    it('keeps an exact rejected redo retryable', () => {
        mocks.duplicateTimeRange.mockReturnValue({
            status: 'applied',
            hasChanges: true,
            replayPlan: { version: 1 },
            inversePlan,
        });
        mocks.prepareRestore
            .mockReturnValueOnce({ status: 'ready', hasChanges: true, apply: vi.fn(() => true) })
            .mockReturnValueOnce({ status: 'rejected', hasChanges: false, apply: vi.fn() })
            .mockReturnValueOnce({ status: 'ready', hasChanges: true, apply: vi.fn(() => true) });
        const transaction = executeUndoableDuplicateTimeRange(4, 8);
        transaction?.undo();
        expect(() => transaction?.redo()).toThrow('Global time operation redo conflicts with current project state');
        expect(() => transaction?.redo()).not.toThrow();
        expect(mocks.prepareRestore).toHaveBeenLastCalledWith({
            ...inversePlan,
            local: { version: 1, expected: 'before', replacement: 'duplicate' },
        });
    });
});
