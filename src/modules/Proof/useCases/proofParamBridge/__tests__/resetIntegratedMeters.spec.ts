import { describe, it, expect } from 'vitest';

import * as subject from '../resetIntegratedMeters';

describe('resetIntegratedMeters', () => {
    it('should export resetIntegratedMeters', () => {
        expect(subject.resetIntegratedMeters).toBeDefined();
        const t = typeof subject.resetIntegratedMeters;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
