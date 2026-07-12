import { describe, it, expect } from 'vitest';

import { setSustainThreshold } from '../setSustainThreshold';

const mock_store = { value: { midiCalibration: {} }, set: () => {} } as never;
describe('setSustainThreshold', () => {
    it('runs without crash when state exists', () => {
        expect(() => setSustainThreshold({ store: mock_store } as never)).not.toThrow();
    });
    it('does nothing when state is null', () => {
        expect(() => setSustainThreshold({ store: { value: null, set: () => {} } } as never)).not.toThrow();
    });
});
