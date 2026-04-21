import { describe, it, expect } from 'vitest';

import * as subject from '../duplicateTimeRange';

describe('duplicateTimeRange', () => {
    it('should export duplicateTimeRange', () => {
        expect(subject.duplicateTimeRange).toBeDefined();
        const time = typeof subject.duplicateTimeRange;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export insertTime', () => {
        expect(subject.insertTime).toBeDefined();
        const time = typeof subject.insertTime;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
