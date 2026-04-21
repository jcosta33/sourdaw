import { describe, it, expect } from 'vitest';

import * as subject from '../getAutomationHandlers';

describe('getAutomationHandlers', () => {
    it('should export getAutomationHandlers', () => {
        expect(subject.getAutomationHandlers).toBeDefined();
        const time = typeof subject.getAutomationHandlers;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
