import { describe, it, expect } from 'vitest';

import * as subject from '../removeSample';

describe('removeSample', () => {
    it('should export removeSample', () => {
        expect(subject.removeSample).toBeDefined();
        const t = typeof subject.removeSample;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
