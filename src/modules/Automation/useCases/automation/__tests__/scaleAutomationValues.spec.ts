import { describe, it, expect } from 'vitest';

import * as subject from '../scaleAutomationValues';

describe('scaleAutomationValues', () => {
    it('should export scaleAutomationValues', () => {
        expect(subject.scaleAutomationValues).toBeDefined();
        const t = typeof subject.scaleAutomationValues;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
