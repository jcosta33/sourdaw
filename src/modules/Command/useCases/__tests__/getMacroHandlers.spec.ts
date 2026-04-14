import { describe, it, expect } from 'vitest';
import * as subject from '../getMacroHandlers';

describe('getMacroHandlers', () => {
    it('should export getMacroHandlers', () => {
        expect(subject.getMacroHandlers).toBeDefined();
        const t = typeof subject.getMacroHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
