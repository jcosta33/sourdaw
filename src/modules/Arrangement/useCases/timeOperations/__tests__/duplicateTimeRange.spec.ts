import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateTimeRange';

describe('duplicateTimeRange', () => {
    it('should export duplicateTimeRange', () => {
        expect(subject.duplicateTimeRange).toBeDefined();
        const t = typeof subject.duplicateTimeRange;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export insertTime', () => {
        expect(subject.insertTime).toBeDefined();
        const t = typeof subject.insertTime;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
