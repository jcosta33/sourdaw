import { describe, it, expect } from 'vitest';

import * as subject from '../removeAutomationPoint';

describe('removeAutomationPoint', () => {
    it('should export removeAutomationPoint', () => {
        expect(subject.removeAutomationPoint).toBeDefined();
        const time = typeof subject.removeAutomationPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
