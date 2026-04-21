import { describe, it, expect } from 'vitest';

import * as subject from '../removeAutomationLane';

describe('removeAutomationLane', () => {
    it('should export removeAutomationLane', () => {
        expect(subject.removeAutomationLane).toBeDefined();
        const time = typeof subject.removeAutomationLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
