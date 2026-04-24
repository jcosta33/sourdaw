import { describe, it, expect } from 'vitest';

import * as subject from '../scanCustomPaths';

describe('scanCustomPaths', () => {
    it('should export scanCustomPaths', () => {
        expect(subject.scanCustomPaths).toBeDefined();
        const time = typeof subject.scanCustomPaths;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
