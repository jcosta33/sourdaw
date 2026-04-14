import { describe, it, expect } from 'vitest';
import * as subject from '../setClipStretchMode';

describe('setClipStretchMode', () => {
    it('should export setClipStretchMode', () => {
        expect(subject.setClipStretchMode).toBeDefined();
        const t = typeof subject.setClipStretchMode;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
