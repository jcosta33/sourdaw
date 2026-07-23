import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeGlobalTimeOperation = vi.hoisted(() => vi.fn());

vi.mock('../executeGlobalTimeOperation', () => ({
    executeGlobalTimeOperation,
}));

import { deleteTime } from '../deleteTime';

describe('deleteTime', () => {
    beforeEach(() => {
        executeGlobalTimeOperation.mockReset();
    });

    it('delegates the legacy numeric signature to the global transaction', () => {
        const expected = {
            status: 'applied',
            hasChanges: true,
            replayPlan: { version: 1 },
        };
        executeGlobalTimeOperation.mockReturnValue(expected);

        const result = deleteTime(2, 6);

        expect(executeGlobalTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: {
                type: 'delete',
                startBeat: 2,
                endBeat: 6,
            },
        });
        expect(result).toBe(expected);
    });

    it('forwards a supplied replay plan without cloning it', () => {
        const replayPlan = {
            version: 1 as const,
            operation: { type: 'delete' as const, startBeat: 2, endBeat: 6 },
            clips: [],
            midi: { version: 1 as const, notes: [] },
        };

        deleteTime(2, 6, replayPlan);

        expect(executeGlobalTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: {
                type: 'delete',
                startBeat: 2,
                endBeat: 6,
            },
            replayPlan,
        });
    });
});
