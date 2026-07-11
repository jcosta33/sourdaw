import { describe, it, expect } from 'vitest';
import { setVelocityFloor } from '../setVelocityFloor';
const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setVelocityFloor', () => {
    it('runs without crash when state exists', () => {
        expect(() => setVelocityFloor({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setVelocityFloor({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
