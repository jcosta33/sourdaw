import { describe, it, expect } from 'vitest';

import * as subject from '../createAutomationLane';

describe('createAutomationLane', () => {
    it('should export createAutomationLane', () => {
        expect(subject.createAutomationLane).toBeDefined();
        const time = typeof subject.createAutomationLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
