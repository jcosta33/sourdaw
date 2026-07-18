import { describe, it, expect } from 'vitest';

import * as subject from '../addAutomationSubLane';

describe('addAutomationSubLane', () => {
    it('should export addAutomationSubLane', () => {
        expect(subject.addAutomationSubLane).toBeDefined();
        const time = typeof subject.addAutomationSubLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
