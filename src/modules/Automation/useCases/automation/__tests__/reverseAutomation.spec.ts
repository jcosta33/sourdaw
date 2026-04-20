import { describe, it, expect } from 'vitest';

import * as subject from '../reverseAutomation';

describe('reverseAutomation', () => {
    it('should export reverseAutomation', () => {
        expect(subject.reverseAutomation).toBeDefined();
        const t = typeof subject.reverseAutomation;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
