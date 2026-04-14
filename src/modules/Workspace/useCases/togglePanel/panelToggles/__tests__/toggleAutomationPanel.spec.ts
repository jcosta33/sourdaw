import { describe, it, expect } from 'vitest';
import * as subject from '../toggleAutomationPanel';

describe('toggleAutomationPanel', () => {
    it('should export toggleAutomationPanel', () => {
        expect(subject.toggleAutomationPanel).toBeDefined();
        const t = typeof subject.toggleAutomationPanel;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
