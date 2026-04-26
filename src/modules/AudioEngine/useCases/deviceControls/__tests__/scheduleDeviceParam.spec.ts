import { describe, it, expect } from 'vitest';

import * as subject from '../scheduleDeviceParam';

describe('scheduleDeviceParam', () => {
    it('should export scheduleDeviceParam', () => {
        expect(subject.scheduleDeviceParam).toBeDefined();
        const time = typeof subject.scheduleDeviceParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
