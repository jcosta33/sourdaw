import { describe, it, expect } from 'vitest';
import * as subject from '../createAutomationLane';

describe('createAutomationLane', () => {
    it('should export createAutomationLane', () => {
        expect(subject.createAutomationLane).toBeDefined();
        const t = typeof subject.createAutomationLane;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
