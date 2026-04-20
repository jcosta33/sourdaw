import { describe, it, expect } from 'vitest';

import * as subject from '../getSelectedClipId';

describe('getSelectedClipId', () => {
    it('should export getSelectedClipId', () => {
        expect(subject.getSelectedClipId).toBeDefined();
        const t = typeof subject.getSelectedClipId;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
