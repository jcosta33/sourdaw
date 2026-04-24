import { describe, it, expect } from 'vitest';

import * as subject from '../setAutoSaveInterval';

describe('setAutoSaveInterval', () => {
    it('should export setAutoSaveInterval', () => {
        expect(subject.setAutoSaveInterval).toBeDefined();
        const time = typeof subject.setAutoSaveInterval;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
