import { describe, it, expect } from 'vitest';

import * as subject from '../setClipStretchRatio';

describe('setClipStretchRatio', () => {
    it('should export setClipStretchRatio', () => {
        expect(subject.setClipStretchRatio).toBeDefined();
        const t = typeof subject.setClipStretchRatio;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
