import { describe, it, expect } from 'vitest';

import * as subject from '../applyParams';

describe('applyParams', () => {
    it('should export applyParams', () => {
        expect(subject.applyParams).toBeDefined();
        const time = typeof subject.applyParams;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
