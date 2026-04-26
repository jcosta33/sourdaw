import { describe, it, expect } from 'vitest';

import * as subject from '../reportLatency';

describe('reportLatency', () => {
    it('should export reportLatency', () => {
        expect(subject.reportLatency).toBeDefined();
        const time = typeof subject.reportLatency;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
