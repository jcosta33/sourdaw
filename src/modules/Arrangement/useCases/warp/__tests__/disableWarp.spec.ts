import { describe, it, expect } from 'vitest';

import * as subject from '../disableWarp';

describe('disableWarp', () => {
    it('should export disableWarp', () => {
        expect(subject.disableWarp).toBeDefined();
        const time = typeof subject.disableWarp;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
