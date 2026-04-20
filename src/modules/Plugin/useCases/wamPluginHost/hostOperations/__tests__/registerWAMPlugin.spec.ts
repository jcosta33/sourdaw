import { describe, it, expect } from 'vitest';

import * as subject from '../registerWAMPlugin';

describe('registerWAMPlugin', () => {
    it('should export registerWAMPlugin', () => {
        expect(subject.registerWAMPlugin).toBeDefined();
        const t = typeof subject.registerWAMPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
