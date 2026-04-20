import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateArrangement';

describe('duplicateArrangement', () => {
    it('should export duplicateArrangement', () => {
        expect(subject.duplicateArrangement).toBeDefined();
        const t = typeof subject.duplicateArrangement;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
