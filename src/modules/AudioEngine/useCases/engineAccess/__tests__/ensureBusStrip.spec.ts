import { describe, it, expect } from 'vitest';
import * as subject from '../ensureBusStrip';

describe('ensureBusStrip', () => {
    it('should export ensureBusStrip', () => {
        expect(subject.ensureBusStrip).toBeDefined();
        const t = typeof subject.ensureBusStrip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
