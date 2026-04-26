import { describe, it, expect } from 'vitest';

import * as subject from '../stretchAutomationTime';

describe('stretchAutomationTime', () => {
    it('should export stretchAutomationTime', () => {
        expect(subject.stretchAutomationTime).toBeDefined();
        const time = typeof subject.stretchAutomationTime;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
