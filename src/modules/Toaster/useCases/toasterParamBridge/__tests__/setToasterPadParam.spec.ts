import { describe, it, expect } from 'vitest';

import * as subject from '../setToasterPadParam';

describe('setToasterPadParam', () => {
    it('should export setToasterPadParam', () => {
        expect(subject.setToasterPadParam).toBeDefined();
        const t = typeof subject.setToasterPadParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
