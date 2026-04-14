import { describe, it, expect } from 'vitest';
import * as subject from '../helpers';

describe('helpers', () => {
    it('should export addTrackWithDevices', () => {
        expect(subject.addTrackWithDevices).toBeDefined();
        const t = typeof subject.addTrackWithDevices;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export attachSynthDevice', () => {
        expect(subject.attachSynthDevice).toBeDefined();
        const t = typeof subject.attachSynthDevice;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export getSynthDeviceCounter', () => {
        expect(subject.getSynthDeviceCounter).toBeDefined();
        const t = typeof subject.getSynthDeviceCounter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
    it('should export resetSynthDeviceCounter', () => {
        expect(subject.resetSynthDeviceCounter).toBeDefined();
        const t = typeof subject.resetSynthDeviceCounter;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
