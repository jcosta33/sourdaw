import { describe, it, expect } from 'vitest';

import * as subject from '../enableWarp';

describe('enableWarp', () => {
    it('should export enableWarp', () => {
        expect(subject.enableWarp).toBeDefined();
        const time = typeof subject.enableWarp;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
