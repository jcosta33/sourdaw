import { describe, it, expect } from 'vitest';

import * as subject from '../reportLatency';

describe('reportLatency', () => {
    it('should export reportLatency', () => {
        expect(subject.reportLatency).toBeDefined();
        const t = typeof subject.reportLatency;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
