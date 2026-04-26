import { describe, it, expect } from 'vitest';

import * as subject from '../getAutomationValueAtBeat';

describe('getAutomationValueAtBeat', () => {
    it('should export getAutomationValueAtBeat', () => {
        expect(subject.getAutomationValueAtBeat).toBeDefined();
        const time = typeof subject.getAutomationValueAtBeat;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
