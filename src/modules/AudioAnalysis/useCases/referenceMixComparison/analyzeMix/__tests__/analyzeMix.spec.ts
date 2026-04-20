import { describe, it, expect } from 'vitest';

import * as subject from '../analyzeMix';

describe('analyzeMix', () => {
    it('should export analyzeMix', () => {
        expect(subject.analyzeMix).toBeDefined();
        const t = typeof subject.analyzeMix;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
