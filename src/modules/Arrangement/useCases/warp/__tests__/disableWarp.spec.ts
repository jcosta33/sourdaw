import { describe, it, expect } from 'vitest';

import * as subject from '../disableWarp';

describe('disableWarp', () => {
    it('should export disableWarp', () => {
        expect(subject.disableWarp).toBeDefined();
        const t = typeof subject.disableWarp;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
