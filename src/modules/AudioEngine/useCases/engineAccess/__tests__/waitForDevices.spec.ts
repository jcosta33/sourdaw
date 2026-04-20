import { describe, it, expect } from 'vitest';

import * as subject from '../waitForDevices';

describe('waitForDevices', () => {
    it('should export waitForDevices', () => {
        expect(subject.waitForDevices).toBeDefined();
        const t = typeof subject.waitForDevices;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
