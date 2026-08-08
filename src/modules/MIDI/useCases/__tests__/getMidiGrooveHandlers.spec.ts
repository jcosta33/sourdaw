import { describe, expect, it } from 'vitest';

import { getMidiGrooveHandlers } from '../getMidiGrooveHandlers';

describe('getMidiGrooveHandlers', () => {
    const handlers = getMidiGrooveHandlers();
    const expectedKeys = [
        'createGrooveTemplate',
        'renameGrooveTemplate',
        'restoreGrooveTemplateName',
        'deleteGrooveTemplate',
        'restoreDeletedGrooveTemplate',
        'assignGrooveTemplate',
        'restoreGrooveAssignment',
        'extractGroove',
        'applyGroove',
    ];

    it('returns exactly 9 groove action handlers', () => {
        expect(Object.keys(handlers)).toHaveLength(9);
    });

    it('every expected action type has a handler', () => {
        for (const key of expectedKeys) {
            expect(handlers[key as keyof typeof handlers]).toBeDefined();
        }
    });

    it('every handler has execute, describe, and undoable properties', () => {
        for (const key of expectedKeys) {
            const handler = handlers[key as keyof typeof handlers];
            expect(typeof handler.execute).toBe('function');
            expect(typeof handler.describe).toBe('function');
            expect(typeof handler.undoable).toBe('boolean');
        }
    });

    it('returns a fresh object on each call (not a cached singleton)', () => {
        const second = getMidiGrooveHandlers();

        expect(second).not.toBe(handlers);
        // But same handler function references (imported at module level).
        expect(second.createGrooveTemplate).toBe(handlers.createGrooveTemplate);
    });
});
