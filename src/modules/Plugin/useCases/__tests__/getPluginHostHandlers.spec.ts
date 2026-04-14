import { describe, it, expect } from 'vitest';
import * as subject from '../getPluginHostHandlers';

describe('getPluginHostHandlers', () => {
    it('should export getPluginHostHandlers', () => {
        expect(subject.getPluginHostHandlers).toBeDefined();
        const t = typeof subject.getPluginHostHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
