import { describe, it, expect } from 'vitest';

import * as subject from '../setAutomationPointCurve';

describe('setAutomationPointCurve', () => {
    it('should export setAutomationPointCurve', () => {
        expect(subject.setAutomationPointCurve).toBeDefined();
        const time = typeof subject.setAutomationPointCurve;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
