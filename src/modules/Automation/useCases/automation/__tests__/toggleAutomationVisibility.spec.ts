import { describe, it, expect } from 'vitest';

import * as subject from '../toggleAutomationVisibility';

describe('toggleAutomationVisibility', () => {
    it('should export toggleAutomationVisibility', () => {
        expect(subject.toggleAutomationVisibility).toBeDefined();
        const time = typeof subject.toggleAutomationVisibility;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
