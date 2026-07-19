import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTimeSignatureChanges } from '../getTimeSignatureChanges';

const mocks = vi.hoisted((): { storeValue: { changes: unknown[] } | null } => ({
    storeValue: {
        changes: [{ beat: 0, numerator: 4, denominator: 4 }],
    },
}));

vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return mocks.storeValue;
        },
    },
}));

describe('getTimeSignatureChanges', () => {
    beforeEach(() => {
        mocks.storeValue = {
            changes: [{ beat: 0, numerator: 4, denominator: 4 }],
        };
    });

    it('should return an empty array when the store is not initialized', () => {
        mocks.storeValue = null;

        expect(getTimeSignatureChanges()).toEqual([]);
    });

    it('should return the changes array from the time signature map store', () => {
        const changes = mocks.storeValue!.changes;
        expect(getTimeSignatureChanges()).toBe(changes);
    });
});
