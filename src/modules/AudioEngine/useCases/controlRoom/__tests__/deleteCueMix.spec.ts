import { describe, it, expect } from 'vitest';

import * as subject from '../deleteCueMix';

describe('deleteCueMix', () => {
    it('should export deleteCueMix', () => {
        expect(subject.deleteCueMix).toBeDefined();
        const time = typeof subject.deleteCueMix;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
