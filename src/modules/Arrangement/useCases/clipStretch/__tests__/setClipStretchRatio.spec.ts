import { describe, it, expect } from 'vitest';

import * as subject from '../setClipStretchRatio';

describe('setClipStretchRatio', () => {
    it('should export setClipStretchRatio', () => {
        expect(subject.setClipStretchRatio).toBeDefined();
        const time = typeof subject.setClipStretchRatio;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
