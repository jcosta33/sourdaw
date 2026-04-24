import { describe, it, expect } from 'vitest';

import * as subject from '../createVcaGroup';

describe('createVcaGroup', () => {
    it('should export createVcaGroup', () => {
        expect(subject.createVcaGroup).toBeDefined();
        const time = typeof subject.createVcaGroup;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
