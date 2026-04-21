import { describe, it, expect } from 'vitest';

import * as subject from '../applyAutomation';

describe('applyAutomation', () => {
    it('should export applyAutomation', () => {
        expect(subject.applyAutomation).toBeDefined();
        const time = typeof subject.applyAutomation;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
