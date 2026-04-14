import { describe, it, expect } from 'vitest';
import * as subject from '../enableWarp';

describe('enableWarp', () => {
    it('should export enableWarp', () => {
        expect(subject.enableWarp).toBeDefined();
        const t = typeof subject.enableWarp;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
