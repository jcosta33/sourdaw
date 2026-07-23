import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeGlobalTimeOperation = vi.hoisted(() => vi.fn());

vi.mock('../executeGlobalTimeOperation', () => ({
    executeGlobalTimeOperation,
}));

import { duplicateTimeRange } from '../duplicateTimeRange';

describe('duplicateTimeRange', () => {
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

        const result = duplicateTimeRange(4, 6);

        expect(executeGlobalTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: {
                type: 'duplicate',
                startBeat: 4,
                endBeat: 6,
            },
        });
        expect(result).toBe(expected);
    });

    it('forwards a supplied replay plan without cloning it', () => {
        const replayPlan = {
            version: 1 as const,
            operation: { type: 'duplicate' as const, startBeat: 4, endBeat: 6 },
            clips: [],
            midi: { version: 1 as const, notes: [] },
        };

        duplicateTimeRange(4, 6, replayPlan);

        expect(executeGlobalTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: {
                type: 'duplicate',
                startBeat: 4,
                endBeat: 6,
            },
            replayPlan,
        });
    });
});
