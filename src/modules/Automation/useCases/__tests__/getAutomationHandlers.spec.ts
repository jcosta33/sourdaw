import { describe, it, expect } from 'vitest';

import * as subject from '../getAutomationHandlers';

describe('getAutomationHandlers', () => {
    it('should export getAutomationHandlers', () => {
        expect(subject.getAutomationHandlers).toBeDefined();
        const t = typeof subject.getAutomationHandlers;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
