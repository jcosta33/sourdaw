import { describe, it, expect } from 'vitest';

import * as subject from '../reverseAutomation';

describe('reverseAutomation', () => {
    it('should export reverseAutomation', () => {
        expect(subject.reverseAutomation).toBeDefined();
        const time = typeof subject.reverseAutomation;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
