import { describe, it, expect } from 'vitest';

import * as subject from '../registerWAMPlugin';

describe('registerWAMPlugin', () => {
    it('should export registerWAMPlugin', () => {
        expect(subject.registerWAMPlugin).toBeDefined();
        const time = typeof subject.registerWAMPlugin;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
