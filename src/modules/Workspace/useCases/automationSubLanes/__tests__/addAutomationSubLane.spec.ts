import { describe, it, expect } from 'vitest';
import * as subject from '../addAutomationSubLane';

describe('addAutomationSubLane', () => {
    it('should export addAutomationSubLane', () => {
        expect(subject.addAutomationSubLane).toBeDefined();
        const t = typeof subject.addAutomationSubLane;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
