import { describe, it, expect } from 'vitest';
import * as subject from '../createFolder';

describe('createFolder', () => {
    it('should export createFolder', () => {
        expect(subject.createFolder).toBeDefined();
        const t = typeof subject.createFolder;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
