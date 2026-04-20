import { describe, it, expect } from 'vitest';

import * as subject from '../removeAutomationLane';

describe('removeAutomationLane', () => {
    it('should export removeAutomationLane', () => {
        expect(subject.removeAutomationLane).toBeDefined();
        const t = typeof subject.removeAutomationLane;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
