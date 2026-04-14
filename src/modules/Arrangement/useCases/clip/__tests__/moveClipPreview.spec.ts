import { describe, it, expect } from 'vitest';
import * as subject from '../moveClipPreview';

describe('moveClipPreview', () => {
    it('should export moveClipPreview', () => {
        expect(subject.moveClipPreview).toBeDefined();
        const t = typeof subject.moveClipPreview;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
