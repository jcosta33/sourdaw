import { describe, it, expect } from 'vitest';

import * as subject from '../persistDeviceParam';

describe('persistDeviceParam', () => {
    it('should export persistDeviceParam', () => {
        expect(subject.persistDeviceParam).toBeDefined();
        const t = typeof subject.persistDeviceParam;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
