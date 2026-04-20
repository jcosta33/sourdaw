import { describe, it, expect } from 'vitest';

import * as subject from '../createVCAGroup';

describe('createVCAGroup', () => {
    it('should export createVCAGroup', () => {
        expect(subject.createVCAGroup).toBeDefined();
        const t = typeof subject.createVCAGroup;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
