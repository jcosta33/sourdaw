import { describe, it, expect } from 'vitest';
import * as subject from '../splitClipWithUndo';

describe('splitClipWithUndo', () => {
    it('should export splitClipWithUndo', () => {
        expect(subject.splitClipWithUndo).toBeDefined();
        const t = typeof subject.splitClipWithUndo;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
