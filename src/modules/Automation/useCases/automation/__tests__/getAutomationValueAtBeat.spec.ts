import { describe, it, expect } from 'vitest';
import * as subject from '../getAutomationValueAtBeat';

describe('getAutomationValueAtBeat', () => {
    it('should export getAutomationValueAtBeat', () => {
        expect(subject.getAutomationValueAtBeat).toBeDefined();
        const t = typeof subject.getAutomationValueAtBeat;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
