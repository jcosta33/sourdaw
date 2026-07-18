import { describe, it, expect } from 'vitest';

import * as subject from '../calibrateMonitor';

describe('calibrateMonitor', () => {
    it('should export calibrateMonitor', () => {
        expect(subject.calibrateMonitor).toBeDefined();
        const time = typeof subject.calibrateMonitor;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
