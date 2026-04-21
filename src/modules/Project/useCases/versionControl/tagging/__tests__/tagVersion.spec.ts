import { describe, it, expect } from 'vitest';

import * as subject from '../tagVersion';

describe('tagVersion', () => {
    it('should export tagVersion', () => {
        expect(subject.tagVersion).toBeDefined();
        const time = typeof subject.tagVersion;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
