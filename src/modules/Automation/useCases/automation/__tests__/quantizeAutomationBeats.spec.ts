import { describe, it, expect } from 'vitest';
import * as subject from '../quantizeAutomationBeats';

describe('quantizeAutomationBeats', () => {
    it('should export quantizeAutomationBeats', () => {
        expect(subject.quantizeAutomationBeats).toBeDefined();
        const t = typeof subject.quantizeAutomationBeats;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
