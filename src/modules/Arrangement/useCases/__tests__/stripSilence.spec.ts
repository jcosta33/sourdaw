import { describe, it, expect } from 'vitest';

import * as subject from '../stripSilence';

describe('stripSilence', () => {
    it('should export stripSilence', () => {
        expect(subject.stripSilence).toBeDefined();
        const time = typeof subject.stripSilence;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
