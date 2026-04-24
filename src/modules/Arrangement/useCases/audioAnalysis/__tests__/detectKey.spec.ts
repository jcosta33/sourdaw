import { describe, it, expect } from 'vitest';

import * as subject from '../detectKey';

describe('detectKey', () => {
    it('should export detectKey', () => {
        expect(subject.detectKey).toBeDefined();
        const time = typeof subject.detectKey;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
