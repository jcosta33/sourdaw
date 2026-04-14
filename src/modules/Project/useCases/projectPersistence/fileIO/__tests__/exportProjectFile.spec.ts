import { describe, it, expect } from 'vitest';
import * as subject from '../exportProjectFile';

describe('exportProjectFile', () => {
    it('should export exportProjectFile', () => {
        expect(subject.exportProjectFile).toBeDefined();
        const t = typeof subject.exportProjectFile;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
