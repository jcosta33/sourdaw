import { describe, it, expect } from 'vitest';
import * as subject from '../restoreVersion';

describe('restoreVersion', () => {
    it('should export restoreVersion', () => {
        expect(subject.restoreVersion).toBeDefined();
        const t = typeof subject.restoreVersion;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
