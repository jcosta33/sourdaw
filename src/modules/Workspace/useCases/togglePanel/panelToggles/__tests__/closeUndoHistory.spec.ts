import { describe, it, expect } from 'vitest';

import * as subject from '../closeUndoHistory';

describe('closeUndoHistory', () => {
    it('should export closeUndoHistory', () => {
        expect(subject.closeUndoHistory).toBeDefined();
        const time = typeof subject.closeUndoHistory;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
