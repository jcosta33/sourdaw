import { describe, expect, it } from 'vitest';

import { pendingRecentLoads } from '../pendingRecentLoads';

describe('pendingRecentLoads', () => {
    it('keeps a captured load chosen until the open project is chosen', () => {
        const isStillChosen = pendingRecentLoads.capture();

        expect(isStillChosen()).toBe(true);

        pendingRecentLoads.withdraw();

        expect(isStillChosen()).toBe(false);
    });

    it('withdraws every load captured before the choice and none captured after it', () => {
        const first = pendingRecentLoads.capture();
        const second = pendingRecentLoads.capture();

        pendingRecentLoads.withdraw();
        const afterChoice = pendingRecentLoads.capture();

        expect(first()).toBe(false);
        expect(second()).toBe(false);
        expect(afterChoice()).toBe(true);
    });
});
