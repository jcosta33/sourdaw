import { describe, it, expect } from 'vitest';

import * as subject from '../swapAutomationSubLaneParam';

describe('swapAutomationSubLaneParam', () => {
    it('should export swapAutomationSubLaneParam', () => {
        expect(subject.swapAutomationSubLaneParam).toBeDefined();
        const time = typeof subject.swapAutomationSubLaneParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
