import { describe, it, expect } from 'vitest';

import { resetMidiCalibration } from '../resetMidiCalibration';

const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('resetMidiCalibration', () => {
    it('runs without crash when state exists', () => {
        expect(() => resetMidiCalibration({ store: mock_store })).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => resetMidiCalibration({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
