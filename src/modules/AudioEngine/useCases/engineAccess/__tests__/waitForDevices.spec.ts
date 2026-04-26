import { describe, it, expect } from 'vitest';

import * as subject from '../waitForDevices';

describe('waitForDevices', () => {
    it('should export waitForDevices', () => {
        expect(subject.waitForDevices).toBeDefined();
        const time = typeof subject.waitForDevices;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
