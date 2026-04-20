import { describe, it, expect } from 'vitest';

import * as subject from '../setClipLoop';

describe('setClipLoop', () => {
    it('should export setClipLoop', () => {
        expect(subject.setClipLoop).toBeDefined();
        const t = typeof subject.setClipLoop;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
