import { describe, it, expect } from 'vitest';

import * as subject from '../applyParams';

describe('applyParams', () => {
    it('should export applyParams', () => {
        expect(subject.applyParams).toBeDefined();
        const t = typeof subject.applyParams;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
