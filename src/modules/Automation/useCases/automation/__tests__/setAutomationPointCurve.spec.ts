import { describe, it, expect } from 'vitest';
import * as subject from '../setAutomationPointCurve';

describe('setAutomationPointCurve', () => {
    it('should export setAutomationPointCurve', () => {
        expect(subject.setAutomationPointCurve).toBeDefined();
        const t = typeof subject.setAutomationPointCurve;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
