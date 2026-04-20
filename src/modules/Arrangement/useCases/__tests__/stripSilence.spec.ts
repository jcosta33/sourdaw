import { describe, it, expect } from 'vitest';

import * as subject from '../stripSilence';

describe('stripSilence', () => {
    it('should export stripSilence', () => {
        expect(subject.stripSilence).toBeDefined();
        const t = typeof subject.stripSilence;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
