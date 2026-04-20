import { describe, it, expect } from 'vitest';

import * as subject from '../autoSaveVersion';

describe('autoSaveVersion', () => {
    it('should export autoSaveVersion', () => {
        expect(subject.autoSaveVersion).toBeDefined();
        const t = typeof subject.autoSaveVersion;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
