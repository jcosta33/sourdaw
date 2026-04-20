import { describe, it, expect } from 'vitest';

import * as subject from '../deleteTime';

describe('deleteTime', () => {
    it('should export deleteTime', () => {
        expect(subject.deleteTime).toBeDefined();
        const t = typeof subject.deleteTime;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
