import { describe, it, expect } from 'vitest';

import * as subject from '../setAutoSaveInterval';

describe('setAutoSaveInterval', () => {
    it('should export setAutoSaveInterval', () => {
        expect(subject.setAutoSaveInterval).toBeDefined();
        const t = typeof subject.setAutoSaveInterval;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
