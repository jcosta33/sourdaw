import { describe, it, expect } from 'vitest';

import * as subject from '../clearClipSelection';

describe('clearClipSelection', () => {
    it('should export clearClipSelection', () => {
        expect(subject.clearClipSelection).toBeDefined();
        const time = typeof subject.clearClipSelection;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
