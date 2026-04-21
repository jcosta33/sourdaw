import { describe, it, expect } from 'vitest';

import * as subject from '../analyzeMix';

describe('analyzeMix', () => {
    it('should export analyzeMix', () => {
        expect(subject.analyzeMix).toBeDefined();
        const time = typeof subject.analyzeMix;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
