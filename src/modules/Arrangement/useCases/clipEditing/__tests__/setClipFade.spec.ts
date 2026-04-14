import { describe, it, expect } from 'vitest';
import * as subject from '../setClipFade';

describe('setClipFade', () => {
    it('should export setClipFade', () => {
        expect(subject.setClipFade).toBeDefined();
        const t = typeof subject.setClipFade;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
