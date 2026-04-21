import { describe, it, expect } from 'vitest';

import * as subject from '../removeDeviceFromStrip';

describe('removeDeviceFromStrip', () => {
    it('should export removeDeviceFromStrip', () => {
        expect(subject.removeDeviceFromStrip).toBeDefined();
        const time = typeof subject.removeDeviceFromStrip;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
