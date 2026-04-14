import { describe, it, expect } from 'vitest';
import * as subject from '../createProjectVersion';

describe('createProjectVersion', () => {
    it('should export createProjectVersion', () => {
        expect(subject.createProjectVersion).toBeDefined();
        const t = typeof subject.createProjectVersion;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
