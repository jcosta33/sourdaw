import { describe, it, expect } from 'vitest';

import * as subject from '../syncArrangement';

describe('syncArrangement', () => {
    it('should export syncArrangement', () => {
        expect(subject.syncArrangement).toBeDefined();
        const time = typeof subject.syncArrangement;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
