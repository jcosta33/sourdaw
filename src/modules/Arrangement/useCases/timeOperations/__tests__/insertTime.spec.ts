import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeGlobalTimeOperation = vi.hoisted(() => vi.fn());

vi.mock('../executeGlobalTimeOperation', () => ({
    executeGlobalTimeOperation,
}));

import { insertTime } from '../insertTime';

describe('insertTime', () => {
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

        const result = insertTime(4, 2);

        expect(executeGlobalTimeOperation).toHaveBeenCalledExactlyOnceWith({
            operation: {
                type: 'insert',
                atBeat: 4,
                durationBeats: 2,
            },
        });
        expect(result).toBe(expected);
    });
});
