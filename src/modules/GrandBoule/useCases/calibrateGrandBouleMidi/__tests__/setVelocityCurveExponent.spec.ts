import { describe, it, expect } from 'vitest';
import { setVelocityCurveExponent } from '../setVelocityCurveExponent';
const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setVelocityCurveExponent', () => {
    it('runs without crash when state exists', () => {
        expect(() => setVelocityCurveExponent({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setVelocityCurveExponent({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
