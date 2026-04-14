import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export getDeviceLatencyMs', () => {
        expect(subject.getDeviceLatencyMs).toBeDefined();
        const t = typeof subject.getDeviceLatencyMs;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getMaxTrackLatency', () => {
        expect(subject.getMaxTrackLatency).toBeDefined();
        const t = typeof subject.getMaxTrackLatency;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getTrackLatency', () => {
        expect(subject.getTrackLatency).toBeDefined();
        const t = typeof subject.getTrackLatency;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
