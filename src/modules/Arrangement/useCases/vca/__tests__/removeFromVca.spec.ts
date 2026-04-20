import { describe, it, expect } from 'vitest';

import * as subject from '../removeFromVca';

describe('removeFromVca', () => {
    it('should export removeFromVca', () => {
        expect(subject.removeFromVca).toBeDefined();
        const t = typeof subject.removeFromVca;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
