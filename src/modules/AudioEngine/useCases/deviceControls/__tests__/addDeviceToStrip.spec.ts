import { describe, it, expect } from 'vitest';

import * as subject from '../addDeviceToStrip';

describe('addDeviceToStrip', () => {
    it('should export addDeviceToStrip', () => {
        expect(subject.addDeviceToStrip).toBeDefined();
        const time = typeof subject.addDeviceToStrip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
