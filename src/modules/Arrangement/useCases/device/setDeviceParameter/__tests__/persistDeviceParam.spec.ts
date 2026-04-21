import { describe, it, expect } from 'vitest';

import * as subject from '../persistDeviceParam';

describe('persistDeviceParam', () => {
    it('should export persistDeviceParam', () => {
        expect(subject.persistDeviceParam).toBeDefined();
        const time = typeof subject.persistDeviceParam;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
