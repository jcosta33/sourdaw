import { describe, it, expect } from 'vitest';

import * as subject from '../swapAutomationSubLaneParam';

describe('swapAutomationSubLaneParam', () => {
    it('should export swapAutomationSubLaneParam', () => {
        expect(subject.swapAutomationSubLaneParam).toBeDefined();
        const t = typeof subject.swapAutomationSubLaneParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
