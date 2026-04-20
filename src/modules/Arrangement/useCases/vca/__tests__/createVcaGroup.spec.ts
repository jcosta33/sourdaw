import { describe, it, expect } from 'vitest';

import * as subject from '../createVcaGroup';

describe('createVcaGroup', () => {
    it('should export createVcaGroup', () => {
        expect(subject.createVcaGroup).toBeDefined();
        const t = typeof subject.createVcaGroup;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
