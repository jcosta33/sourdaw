import { describe, it, expect } from 'vitest';

import * as subject from '../setClipStretchMode';

describe('setClipStretchMode', () => {
    it('should export setClipStretchMode', () => {
        expect(subject.setClipStretchMode).toBeDefined();
        const time = typeof subject.setClipStretchMode;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
