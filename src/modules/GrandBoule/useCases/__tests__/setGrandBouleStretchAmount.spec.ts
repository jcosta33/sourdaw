import { describe, it, expect } from 'vitest';
import { setGrandBouleStretchAmount } from '../setGrandBouleStretchAmount';

const mock_engine = new Proxy({}, { get: () => () => {} }) as never;

describe('setGrandBouleStretchAmount', () => {
    it('runs without crash when state exists', () => {
        const store = { value: { pedals: {}, params: {} }, set: () => {} } as never;
        expect(() => setGrandBouleStretchAmount({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('does nothing when state is null', () => {
        const store = { value: null, set: () => {} } as never;
        expect(() => setGrandBouleStretchAmount({ store, engine: mock_engine } as never)).not.toThrow();
    });
});
