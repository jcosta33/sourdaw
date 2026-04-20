import { describe, it, expect } from 'vitest';

import * as subject from '../assignToVca';

describe('assignToVca', () => {
    it('should export assignToVca', () => {
        expect(subject.assignToVca).toBeDefined();
        const t = typeof subject.assignToVca;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
