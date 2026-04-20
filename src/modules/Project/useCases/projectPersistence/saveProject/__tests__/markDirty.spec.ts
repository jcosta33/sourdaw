import { describe, it, expect } from 'vitest';

import * as subject from '../markDirty';

describe('markDirty', () => {
    it('should export markDirty', () => {
        expect(subject.markDirty).toBeDefined();
        const t = typeof subject.markDirty;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
