import { describe, it, expect } from 'vitest';

import * as subject from '../createCueMix';

describe('createCueMix', () => {
    it('should export createCueMix', () => {
        expect(subject.createCueMix).toBeDefined();
        const time = typeof subject.createCueMix;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
