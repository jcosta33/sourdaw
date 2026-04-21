import { describe, it, expect } from 'vitest';

import * as subject from '../getUndoTreeHandlers';

describe('getUndoTreeHandlers', () => {
    it('should export getUndoTreeHandlers', () => {
        expect(subject.getUndoTreeHandlers).toBeDefined();
        const time = typeof subject.getUndoTreeHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
