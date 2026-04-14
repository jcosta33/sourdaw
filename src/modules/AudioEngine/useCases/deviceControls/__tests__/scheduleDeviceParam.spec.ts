import { describe, it, expect } from 'vitest';
import * as subject from '../scheduleDeviceParam';

describe('scheduleDeviceParam', () => {
    it('should export scheduleDeviceParam', () => {
        expect(subject.scheduleDeviceParam).toBeDefined();
        const t = typeof subject.scheduleDeviceParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
