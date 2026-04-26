import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateArrangement';

describe('duplicateArrangement', () => {
    it('should export duplicateArrangement', () => {
        expect(subject.duplicateArrangement).toBeDefined();
        const time = typeof subject.duplicateArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
