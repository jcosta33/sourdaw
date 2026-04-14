import { describe, it, expect } from 'vitest';
import * as subject from '../calibrateMonitor';

describe('calibrateMonitor', () => {
    it('should export calibrateMonitor', () => {
        expect(subject.calibrateMonitor).toBeDefined();
        const t = typeof subject.calibrateMonitor;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
