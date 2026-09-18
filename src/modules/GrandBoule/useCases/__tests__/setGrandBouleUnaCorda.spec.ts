import { describe, it, expect, vi } from 'vitest';

import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore } from '../../stores/grandBouleStore';
import { setGrandBouleUnaCorda } from '../setGrandBouleUnaCorda';

const mock_engine = new Proxy({}, { get: () => () => {} }) as never;

describe('setGrandBouleUnaCorda', () => {
    it('runs without crash when state exists', () => {
        const store = { value: { pedals: {}, params: {} }, set: () => {} } as never;
        expect(() => setGrandBouleUnaCorda({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('does nothing when state is null', () => {
        const store = { value: null, set: () => {} } as never;
        expect(() => setGrandBouleUnaCorda({ store, engine: mock_engine } as never)).not.toThrow();
    });

    it('writes the store alone when no engine is given, because the pedal route already reached the bodies', () => {
        const store = createGrandBouleStore('una-corda-store-only');
        const setUnaCorda = vi.fn();
        const engine: GrandBouleEngineHandle = {
            ...createDisconnectedGrandBouleEngineHandle(),
            setUnaCorda,
        };

        setGrandBouleUnaCorda({ store, engine, engaged: false });
        expect(setUnaCorda).toHaveBeenCalledWith({ engaged: false });

        setGrandBouleUnaCorda({ store, engaged: true });

        expect(store.value?.pedals.unaCorda).toBe(true);
        // Still the one write the call that carried an engine made.
        expect(setUnaCorda).toHaveBeenCalledTimes(1);
    });
});
