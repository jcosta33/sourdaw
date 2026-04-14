import { describe, it, expect } from 'vitest';
import * as subject from '../resetMidiCalibration';

describe('resetMidiCalibration', () => {
    it('should export resetMidiCalibration', () => {
        expect(subject.resetMidiCalibration).toBeDefined();
        const t = typeof subject.resetMidiCalibration;
        expect(t === 'function' || t === 'object').toBe(true);
    });
});
