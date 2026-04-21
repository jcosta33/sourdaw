import { describe, it, expect } from 'vitest';

import * as subject from '../toggleAutomationPanel';

describe('toggleAutomationPanel', () => {
    it('should export toggleAutomationPanel', () => {
        expect(subject.toggleAutomationPanel).toBeDefined();
        const time = typeof subject.toggleAutomationPanel;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
