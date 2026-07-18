import { describe, it, expect } from 'vitest';

import * as subject from '../randomizeLatent';

describe('randomizeLatent', () => {
    it('should export randomizeLatent', () => {
        expect(subject.randomizeLatent).toBeDefined();
        const time = typeof subject.randomizeLatent;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
