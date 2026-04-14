import { describe, it, expect } from 'vitest';
import * as subject from '../setGrandBouleUnaCorda';

describe('setGrandBouleUnaCorda', () => {
    it('should export setGrandBouleUnaCorda', () => {
        expect(subject.setGrandBouleUnaCorda).toBeDefined();
        const t = typeof subject.setGrandBouleUnaCorda;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
