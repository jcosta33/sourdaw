import { describe, expect, it } from 'vitest';

import { pendingProjectReplacements } from '../pendingProjectReplacements';

describe('pendingProjectReplacements', () => {
    it('keeps a captured replacement chosen until the open project is chosen', () => {
        const isStillChosen = pendingProjectReplacements.capture();

        expect(isStillChosen()).toBe(true);

        pendingProjectReplacements.withdraw();

        expect(isStillChosen()).toBe(false);
    });

    it('withdraws every replacement captured before the choice and none captured after it', () => {
        const first = pendingProjectReplacements.capture();
        const second = pendingProjectReplacements.capture();

        pendingProjectReplacements.withdraw();
        const afterChoice = pendingProjectReplacements.capture();

        expect(first()).toBe(false);
        expect(second()).toBe(false);
        expect(afterChoice()).toBe(true);
    });
});
