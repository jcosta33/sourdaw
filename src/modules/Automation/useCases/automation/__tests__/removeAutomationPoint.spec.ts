import { describe, it, expect } from 'vitest';
import * as subject from '../removeAutomationPoint';

describe('removeAutomationPoint', () => {
    it('should export removeAutomationPoint', () => {
        expect(subject.removeAutomationPoint).toBeDefined();
        const t = typeof subject.removeAutomationPoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
