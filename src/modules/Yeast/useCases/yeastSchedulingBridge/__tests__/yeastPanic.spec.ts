import { describe, it, expect } from 'vitest';

import * as subject from '../yeastPanic';

describe('yeastPanic', () => {
    it('should export yeastPanic', () => {
        expect(subject.yeastPanic).toBeDefined();
        const time = typeof subject.yeastPanic;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
