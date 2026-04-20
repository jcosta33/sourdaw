import { describe, it, expect } from 'vitest';

import * as subject from '../createCueMix';

describe('createCueMix', () => {
    it('should export createCueMix', () => {
        expect(subject.createCueMix).toBeDefined();
        const t = typeof subject.createCueMix;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
