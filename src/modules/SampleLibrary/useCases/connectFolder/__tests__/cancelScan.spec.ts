import { describe, it, expect } from 'vitest';

import * as subject from '../cancelScan';

describe('cancelScan', () => {
    it('should export cancelScan', () => {
        expect(subject.cancelScan).toBeDefined();
        const t = typeof subject.cancelScan;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
