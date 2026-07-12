import { describe, it, expect } from 'vitest';

import { setGrandBouleSoundboardSend } from '../setGrandBouleSoundboardSend';

const mock_engine = new Proxy({}, { get: () => () => {} }) as never;

describe('setGrandBouleSoundboardSend', () => {
    it('runs without crash when state exists', () => {
        const store = { value: { pedals: {}, params: {} }, set: () => {} } as never;
        expect(() => setGrandBouleSoundboardSend({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('does nothing when state is null', () => {
        const store = { value: null, set: () => {} } as never;
        expect(() => setGrandBouleSoundboardSend({ store, engine: mock_engine } as never)).not.toThrow();
    });
});
