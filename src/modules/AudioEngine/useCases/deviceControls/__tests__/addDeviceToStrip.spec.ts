import { describe, it, expect } from 'vitest';

import * as subject from '../addDeviceToStrip';

describe('addDeviceToStrip', () => {
    it('should export addDeviceToStrip', () => {
        expect(subject.addDeviceToStrip).toBeDefined();
        const t = typeof subject.addDeviceToStrip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
