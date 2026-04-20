import { describe, it, expect } from 'vitest';

import * as subject from '../setClipColor';

describe('setClipColor', () => {
    it('should export setClipColor', () => {
        expect(subject.setClipColor).toBeDefined();
        const t = typeof subject.setClipColor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
