import { describe, it, expect } from 'vitest';

import * as subject from '../getLatencyReport';

describe('getLatencyReport', () => {
    it('should export getLatencyReport', () => {
        expect(subject.getLatencyReport).toBeDefined();
        const t = typeof subject.getLatencyReport;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
