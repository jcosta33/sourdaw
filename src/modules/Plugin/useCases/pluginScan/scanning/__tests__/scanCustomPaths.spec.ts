import { describe, it, expect } from 'vitest';
import * as subject from '../scanCustomPaths';

describe('scanCustomPaths', () => {
    it('should export scanCustomPaths', () => {
        expect(subject.scanCustomPaths).toBeDefined();
        const t = typeof subject.scanCustomPaths;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
