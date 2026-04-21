import { describe, it, expect } from 'vitest';

import * as subject from '../updateAutomationPoint';

describe('updateAutomationPoint', () => {
    it('should export updateAutomationPoint', () => {
        expect(subject.updateAutomationPoint).toBeDefined();
        const time = typeof subject.updateAutomationPoint;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
