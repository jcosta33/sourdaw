import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export setAutomationSubLanes', () => {
        expect(subject.setAutomationSubLanes).toBeDefined();
        const t = typeof subject.setAutomationSubLanes;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
