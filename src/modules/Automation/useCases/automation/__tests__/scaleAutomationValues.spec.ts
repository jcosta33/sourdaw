import { describe, it, expect } from 'vitest';

import * as subject from '../scaleAutomationValues';

describe('scaleAutomationValues', () => {
    it('should export scaleAutomationValues', () => {
        expect(subject.scaleAutomationValues).toBeDefined();
        const time = typeof subject.scaleAutomationValues;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
