import { describe, it, expect } from 'vitest';

import * as subject from '../setToasterPadParam';

describe('setToasterPadParam', () => {
    it('should export setToasterPadParam', () => {
        expect(subject.setToasterPadParam).toBeDefined();
        const time = typeof subject.setToasterPadParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
