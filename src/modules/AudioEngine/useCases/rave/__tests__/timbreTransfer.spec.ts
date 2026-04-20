import { describe, it, expect } from 'vitest';

import * as subject from '../timbreTransfer';

describe('timbreTransfer', () => {
    it('should export timbreTransfer', () => {
        expect(subject.timbreTransfer).toBeDefined();
        const t = typeof subject.timbreTransfer;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
