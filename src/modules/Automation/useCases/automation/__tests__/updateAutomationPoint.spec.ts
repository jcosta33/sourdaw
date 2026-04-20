import { describe, it, expect } from 'vitest';

import * as subject from '../updateAutomationPoint';

describe('updateAutomationPoint', () => {
    it('should export updateAutomationPoint', () => {
        expect(subject.updateAutomationPoint).toBeDefined();
        const t = typeof subject.updateAutomationPoint;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
