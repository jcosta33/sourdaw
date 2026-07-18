import { describe, it, expect } from 'vitest';

import * as subject from '../timbreTransfer';

describe('timbreTransfer', () => {
    it('should export timbreTransfer', () => {
        expect(subject.timbreTransfer).toBeDefined();
        const time = typeof subject.timbreTransfer;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
