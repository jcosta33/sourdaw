import { describe, it, expect } from 'vitest';

import * as subject from '../removeAutomationSubLane';

describe('removeAutomationSubLane', () => {
    it('should export removeAutomationSubLane', () => {
        expect(subject.removeAutomationSubLane).toBeDefined();
        const time = typeof subject.removeAutomationSubLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
