import { describe, it, expect } from 'vitest';

import * as subject from '../clearClipSelection';

describe('clearClipSelection', () => {
    it('should export clearClipSelection', () => {
        expect(subject.clearClipSelection).toBeDefined();
        const t = typeof subject.clearClipSelection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
