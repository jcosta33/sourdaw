import { describe, expect, it } from 'vitest';

import { getPitchHandlers } from '../getPitchHandlers';

describe('getPitchHandlers', () => {
    const handlers = getPitchHandlers();

    it('returns exactly 2 pitch handlers', () => {
        expect(Object.keys(handlers)).toHaveLength(2);
    });

    it('has commitPitchEdit and restoreClipFileId', () => {
        expect(handlers.commitPitchEdit).toBeDefined();
        expect(handlers.restoreClipFileId).toBeDefined();
    });

    it('every handler has execute, describe, and undoable', () => {
        for (const handler of [handlers.commitPitchEdit, handlers.restoreClipFileId]) {
            expect(typeof handler.execute).toBe('function');
            expect(typeof handler.describe).toBe('function');
            expect(typeof handler.undoable).toBe('boolean');
        }
    });

    it('returns a fresh object on each call', () => {
        const second = getPitchHandlers();

        expect(second).not.toBe(handlers);
        expect(second.commitPitchEdit).toBe(handlers.commitPitchEdit);
    });
});
