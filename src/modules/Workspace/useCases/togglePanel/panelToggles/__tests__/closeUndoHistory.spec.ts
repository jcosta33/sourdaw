import { describe, it, expect } from 'vitest';
import * as subject from '../closeUndoHistory';

describe('closeUndoHistory', () => {
    it('should export closeUndoHistory', () => {
        expect(subject.closeUndoHistory).toBeDefined();
        const t = typeof subject.closeUndoHistory;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
