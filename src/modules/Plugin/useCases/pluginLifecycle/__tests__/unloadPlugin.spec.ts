import { describe, it, expect } from 'vitest';
import * as subject from '../unloadPlugin';

describe('unloadPlugin', () => {
    it('should export unloadPlugin', () => {
        expect(subject.unloadPlugin).toBeDefined();
        const t = typeof subject.unloadPlugin;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
