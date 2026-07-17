import { describe, it, expect } from 'vitest';

import * as subject from '../setVoltageStandard';

describe('setVoltageStandard', () => {
    it('should export setVoltageStandard', () => {
        expect(subject.setVoltageStandard).toBeDefined();
        const t = typeof subject.setVoltageStandard;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
