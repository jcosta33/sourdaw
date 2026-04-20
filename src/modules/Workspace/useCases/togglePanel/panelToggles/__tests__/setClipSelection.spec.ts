import { describe, it, expect } from 'vitest';

import * as subject from '../setClipSelection';

describe('setClipSelection', () => {
    it('should export setClipSelection', () => {
        expect(subject.setClipSelection).toBeDefined();
        const t = typeof subject.setClipSelection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
