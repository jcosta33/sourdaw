import { describe, it, expect } from 'vitest';

import * as subject from '../addAutomationLane';

describe('addAutomationLane', () => {
    it('should export addAutomationLane', () => {
        expect(subject.addAutomationLane).toBeDefined();
        const time = typeof subject.addAutomationLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
