import { describe, it, expect } from 'vitest';

import * as subject from '../toggleUndoHistory';

describe('toggleUndoHistory', () => {
    it('should export toggleUndoHistory', () => {
        expect(subject.toggleUndoHistory).toBeDefined();
        const time = typeof subject.toggleUndoHistory;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
