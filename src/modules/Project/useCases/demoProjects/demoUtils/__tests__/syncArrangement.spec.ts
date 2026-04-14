import { describe, it, expect } from 'vitest';
import * as subject from '../syncArrangement';

describe('syncArrangement', () => {
    it('should export syncArrangement', () => {
        expect(subject.syncArrangement).toBeDefined();
        const t = typeof subject.syncArrangement;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
