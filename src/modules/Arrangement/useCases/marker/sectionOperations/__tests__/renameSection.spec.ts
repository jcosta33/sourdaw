import { describe, it, expect } from 'vitest';
import * as subject from '../renameSection';

describe('renameSection', () => {
    it('should export renameSection', () => {
        expect(subject.renameSection).toBeDefined();
        const t = typeof subject.renameSection;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
