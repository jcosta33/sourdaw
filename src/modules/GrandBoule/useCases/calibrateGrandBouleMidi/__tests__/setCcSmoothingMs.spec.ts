import { describe, it, expect } from 'vitest';
import { setCcSmoothingMs } from '../setCcSmoothingMs';
const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setCcSmoothingMs', () => {
    it('runs without crash when state exists', () => {
        expect(() => setCcSmoothingMs({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setCcSmoothingMs({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
