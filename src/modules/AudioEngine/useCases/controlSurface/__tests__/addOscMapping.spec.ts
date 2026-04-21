import { describe, it, expect } from 'vitest';

import * as subject from '../addOscMapping';

describe('addOscMapping', () => {
    it('should export addOscMapping', () => {
        expect(subject.addOscMapping).toBeDefined();
        const time = typeof subject.addOscMapping;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
