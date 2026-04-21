import { describe, it, expect } from 'vitest';

import * as subject from '../getCompensationDelay';

describe('getCompensationDelay', () => {
    it('should export getCompensationDelay', () => {
        expect(subject.getCompensationDelay).toBeDefined();
        const time = typeof subject.getCompensationDelay;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
