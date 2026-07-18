import { describe, it, expect, beforeEach } from 'vitest';

import { timeSignatureMapStore } from '../timeSignatureMapStore';

describe('Transport Misc Stores', () => {
    describe('timeSignatureMapStore', () => {
        beforeEach(() => {
            timeSignatureMapStore.set({ changes: [] });
        });

        it('should have initial state', () => {
            expect(timeSignatureMapStore.value?.changes).toHaveLength(0);
        });

        it('should update state', () => {
            const change = { id: '1', beat: 0, numerator: 3, denominator: 4 };
            timeSignatureMapStore.set({ changes: [change] });
            expect(timeSignatureMapStore.value?.changes).toHaveLength(1);
            expect(timeSignatureMapStore.value?.changes[0]).toEqual(change);
        });
    });
});
