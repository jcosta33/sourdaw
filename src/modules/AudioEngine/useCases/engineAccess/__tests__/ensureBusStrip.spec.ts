import { describe, it, expect } from 'vitest';

import * as subject from '../ensureBusStrip';

describe('ensureBusStrip', () => {
    it('should export ensureBusStrip', () => {
        expect(subject.ensureBusStrip).toBeDefined();
        const time = typeof subject.ensureBusStrip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
