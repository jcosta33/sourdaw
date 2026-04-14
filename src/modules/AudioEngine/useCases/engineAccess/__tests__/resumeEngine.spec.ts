import { describe, it, expect } from 'vitest';
import * as subject from '../resumeEngine';

describe('resumeEngine', () => {
    it('should export resumeEngine', () => {
        expect(subject.resumeEngine).toBeDefined();
        const t = typeof subject.resumeEngine;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
