import { describe, it, expect } from 'vitest';

import { setVelocityCeiling } from '../setVelocityCeiling';

const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setVelocityCeiling', () => {
    it('runs without crash when state exists', () => {
        expect(() => setVelocityCeiling({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setVelocityCeiling({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
