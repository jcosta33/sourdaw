import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getDeviceLatencyMs', () => {
        expect(subject.getDeviceLatencyMs).toBeDefined();
        const time = typeof subject.getDeviceLatencyMs;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getMaxTrackLatency', () => {
        expect(subject.getMaxTrackLatency).toBeDefined();
        const time = typeof subject.getMaxTrackLatency;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export getTrackLatency', () => {
        expect(subject.getTrackLatency).toBeDefined();
        const time = typeof subject.getTrackLatency;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
