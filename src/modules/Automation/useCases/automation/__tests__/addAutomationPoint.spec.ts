import { describe, it, expect } from 'vitest';

import * as subject from '../addAutomationPoint';

describe('addAutomationPoint', () => {
    it('should export addAutomationPoint', () => {
        expect(subject.addAutomationPoint).toBeDefined();
        const time = typeof subject.addAutomationPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
