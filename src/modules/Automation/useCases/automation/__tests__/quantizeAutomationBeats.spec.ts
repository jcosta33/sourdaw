import { describe, it, expect } from 'vitest';

import * as subject from '../quantizeAutomationBeats';

describe('quantizeAutomationBeats', () => {
    it('should export quantizeAutomationBeats', () => {
        expect(subject.quantizeAutomationBeats).toBeDefined();
        const time = typeof subject.quantizeAutomationBeats;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
