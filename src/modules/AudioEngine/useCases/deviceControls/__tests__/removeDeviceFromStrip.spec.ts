import { describe, it, expect } from 'vitest';
import * as subject from '../removeDeviceFromStrip';

describe('removeDeviceFromStrip', () => {
    it('should export removeDeviceFromStrip', () => {
        expect(subject.removeDeviceFromStrip).toBeDefined();
        const t = typeof subject.removeDeviceFromStrip;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
