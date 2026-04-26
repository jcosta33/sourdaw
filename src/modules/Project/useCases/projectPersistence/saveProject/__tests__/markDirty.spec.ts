import { describe, it, expect } from 'vitest';

import * as subject from '../markDirty';

describe('markDirty', () => {
    it('should export markDirty', () => {
        expect(subject.markDirty).toBeDefined();
        const time = typeof subject.markDirty;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
