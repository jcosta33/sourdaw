import { describe, it, expect } from 'vitest';

import * as subject from '../toggleUndoHistory';

describe('toggleUndoHistory', () => {
    it('should export toggleUndoHistory', () => {
        expect(subject.toggleUndoHistory).toBeDefined();
        const t = typeof subject.toggleUndoHistory;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
