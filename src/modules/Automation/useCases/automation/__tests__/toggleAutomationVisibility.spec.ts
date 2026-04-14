import { describe, it, expect } from 'vitest';
import * as subject from '../toggleAutomationVisibility';

describe('toggleAutomationVisibility', () => {
    it('should export toggleAutomationVisibility', () => {
        expect(subject.toggleAutomationVisibility).toBeDefined();
        const t = typeof subject.toggleAutomationVisibility;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
