import { describe, it, expect } from 'vitest';
import { setAfterTouchSensitivity } from '../setAfterTouchSensitivity';
const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setAfterTouchSensitivity', () => {
    it('runs without crash when state exists', () => {
        expect(() => setAfterTouchSensitivity({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setAfterTouchSensitivity({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
