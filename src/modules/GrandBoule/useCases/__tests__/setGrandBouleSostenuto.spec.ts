import { describe, it, expect, vi } from 'vitest';

import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore } from '../../stores/grandBouleStore';
import { setGrandBouleSostenuto } from '../setGrandBouleSostenuto';

const mock_engine = new Proxy({}, { get: () => () => {} }) as never;

describe('setGrandBouleSostenuto', () => {
    it('runs without crash when state exists', () => {
        const store = { value: { pedals: {}, params: {} }, set: () => {} } as never;
        expect(() => setGrandBouleSostenuto({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('does nothing when state is null', () => {
        const store = { value: null, set: () => {} } as never;
        expect(() => setGrandBouleSostenuto({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('writes the store alone when no engine is given, because the pedal route already reached the bodies', () => {
        const store = createGrandBouleStore('sostenuto-store-only');
        const setSostenuto = vi.fn();
        const engine: GrandBouleEngineHandle = {
            ...createDisconnectedGrandBouleEngineHandle(),
            setSostenuto,
        };

        setGrandBouleSostenuto({ store, engine, engaged: false });
        expect(setSostenuto).toHaveBeenCalledWith({ engaged: false });

        setGrandBouleSostenuto({ store, engaged: true });

        expect(store.value?.pedals.sostenuto).toBe(true);
        // Still the one write the call that carried an engine made.
        expect(setSostenuto).toHaveBeenCalledTimes(1);
    });
});
