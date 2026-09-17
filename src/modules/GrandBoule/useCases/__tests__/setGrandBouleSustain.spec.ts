import { describe, it, expect, vi } from 'vitest';

import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore } from '../../stores/grandBouleStore';
import { setGrandBouleSustain } from '../setGrandBouleSustain';

const mock_engine = new Proxy({}, { get: () => () => {} }) as never;
describe('setGrandBouleSustain', () => {
    it('updates store when state exists', () => {
        const set = vi.fn();
        setGrandBouleSustain({
            store: { value: { pedals: { sustain: 0 } }, set },
            engine: mock_engine,
            position: 0.5,
        } as never);
        expect(set).toHaveBeenCalledTimes(1);
    });
    it('does nothing when state is null', () => {
        const set = vi.fn();
        setGrandBouleSustain({ store: { value: null, set }, engine: mock_engine, position: 0.5 } as never);
        expect(set).not.toHaveBeenCalled();
    });
    it('clamps position to 0-1', () => {
        const set = vi.fn();
        setGrandBouleSustain({ store: { value: { pedals: {} }, set }, engine: mock_engine, position: 5 } as never);
        expect(set).toHaveBeenCalledTimes(1);
    });

    it('writes the store alone when no engine is given, because the pedal route already reached the bodies', () => {
        const store = createGrandBouleStore('sustain-store-only');
        const setSustain = vi.fn();
        const engine: GrandBouleEngineHandle = {
            ...createDisconnectedGrandBouleEngineHandle(),
            setSustain,
        };

        setGrandBouleSustain({ store, engine, position: 0.25 });
        expect(setSustain).toHaveBeenCalledWith({ position: 0.25 });

        setGrandBouleSustain({ store, position: 0.75 });

        expect(store.value?.pedals.sustain).toBe(0.75);
        // Still the one write the call that carried an engine made.
        expect(setSustain).toHaveBeenCalledTimes(1);
    });
});
