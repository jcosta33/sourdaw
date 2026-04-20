import { describe, it, expect } from 'vitest';

import * as subject from '../addAutomationPoint';

describe('addAutomationPoint', () => {
    it('should export addAutomationPoint', () => {
        expect(subject.addAutomationPoint).toBeDefined();
        const t = typeof subject.addAutomationPoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
