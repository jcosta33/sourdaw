import { describe, it, expect } from 'vitest';

import * as subject from '../renameArrangement';

describe('renameArrangement', () => {
    it('should export renameArrangement', () => {
        expect(subject.renameArrangement).toBeDefined();
        const time = typeof subject.renameArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
