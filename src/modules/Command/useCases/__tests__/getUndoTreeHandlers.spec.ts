import { describe, it, expect } from 'vitest';
import * as subject from '../getUndoTreeHandlers';

describe('getUndoTreeHandlers', () => {
    it('should export getUndoTreeHandlers', () => {
        expect(subject.getUndoTreeHandlers).toBeDefined();
        const t = typeof subject.getUndoTreeHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
