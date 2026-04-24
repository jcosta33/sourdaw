import { describe, it, expect } from 'vitest';

import * as subject from '../restoreVersion';

describe('restoreVersion', () => {
    it('should export restoreVersion', () => {
        expect(subject.restoreVersion).toBeDefined();
        const time = typeof subject.restoreVersion;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
