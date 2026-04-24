import { describe, it, expect } from 'vitest';

import * as subject from '../separateStems';

describe('separateStems', () => {
    it('should export separateStems', () => {
        expect(subject.separateStems).toBeDefined();
        const time = typeof subject.separateStems;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
