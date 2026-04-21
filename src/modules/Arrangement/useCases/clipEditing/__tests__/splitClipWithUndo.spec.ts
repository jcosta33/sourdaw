import { describe, it, expect } from 'vitest';

import * as subject from '../splitClipWithUndo';

describe('splitClipWithUndo', () => {
    it('should export splitClipWithUndo', () => {
        expect(subject.splitClipWithUndo).toBeDefined();
        const time = typeof subject.splitClipWithUndo;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
