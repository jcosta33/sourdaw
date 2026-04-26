import { describe, it, expect } from 'vitest';

import * as subject from '../getLatencyReport';

describe('getLatencyReport', () => {
    it('should export getLatencyReport', () => {
        expect(subject.getLatencyReport).toBeDefined();
        const time = typeof subject.getLatencyReport;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
