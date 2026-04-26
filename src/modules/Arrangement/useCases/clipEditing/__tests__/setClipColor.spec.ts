import { describe, it, expect } from 'vitest';

import * as subject from '../setClipColor';

describe('setClipColor', () => {
    it('should export setClipColor', () => {
        expect(subject.setClipColor).toBeDefined();
        const time = typeof subject.setClipColor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
