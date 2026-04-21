import { describe, it, expect } from 'vitest';

import * as subject from '../helpers';

describe('helpers', () => {
    it('should export addTrackWithDevices', () => {
        expect(subject.addTrackWithDevices).toBeDefined();
        const time = typeof subject.addTrackWithDevices;
        expect(time === 'function' || time === 'object').toBe(true);
    });
    it('should export attachSynthDevice', () => {
        expect(subject.attachSynthDevice).toBeDefined();
        const time = typeof subject.attachSynthDevice;
        expect(time === 'function' || time === 'object').toBe(true);
    });
});
