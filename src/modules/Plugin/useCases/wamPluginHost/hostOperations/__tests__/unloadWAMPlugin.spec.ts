import { describe, it, expect } from 'vitest';
import * as subject from '../unloadWAMPlugin';

describe('unloadWAMPlugin', () => {
    it('should export unloadWAMPlugin', () => {
        expect(subject.unloadWAMPlugin).toBeDefined();
        const t = typeof subject.unloadWAMPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
