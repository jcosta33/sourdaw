import { describe, it, expect } from 'vitest';
import * as subject from '../resolveGrandBouleEngine';

describe('resolveGrandBouleEngine', () => {
    it('should export resolveGrandBouleEngine', () => {
        expect(subject.resolveGrandBouleEngine).toBeDefined();
        const t = typeof subject.resolveGrandBouleEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
