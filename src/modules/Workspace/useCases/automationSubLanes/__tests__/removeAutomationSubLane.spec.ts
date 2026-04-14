import { describe, it, expect } from 'vitest';
import * as subject from '../removeAutomationSubLane';

describe('removeAutomationSubLane', () => {
    it('should export removeAutomationSubLane', () => {
        expect(subject.removeAutomationSubLane).toBeDefined();
        const t = typeof subject.removeAutomationSubLane;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
