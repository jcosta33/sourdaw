import { describe, it, expect } from 'vitest';
import * as subject from '../getSelectedClipIds';

describe('getSelectedClipIds', () => {
    it('should export getSelectedClipIds', () => {
        expect(subject.getSelectedClipIds).toBeDefined();
        const t = typeof subject.getSelectedClipIds;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
