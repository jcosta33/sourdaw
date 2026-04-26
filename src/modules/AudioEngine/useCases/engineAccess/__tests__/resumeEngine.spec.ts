import { describe, it, expect } from 'vitest';

import * as subject from '../resumeEngine';

describe('resumeEngine', () => {
    it('should export resumeEngine', () => {
        expect(subject.resumeEngine).toBeDefined();
        const time = typeof subject.resumeEngine;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
