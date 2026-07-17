import { describe, it, expect } from 'vitest';

import * as subject from '../autoSaveVersion';

describe('autoSaveVersion', () => {
    it('should export autoSaveVersion', () => {
        expect(subject.autoSaveVersion).toBeDefined();
        const time = typeof subject.autoSaveVersion;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
