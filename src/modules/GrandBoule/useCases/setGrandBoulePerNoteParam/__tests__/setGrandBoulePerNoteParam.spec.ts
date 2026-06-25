import { describe, it, expect, vi } from 'vitest';

import { type GrandBoulePerNoteMap, createDefaultPerNoteValues } from '../../../models/GrandBoulePerNoteParams';
import { createDisconnectedGrandBouleEngineHandle } from '../../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, createDefaultGrandBouleState } from '../../../stores/grandBouleStore';
import { setGrandBoulePerNoteParam } from '../setGrandBoulePerNoteParam';

describe('setGrandBoulePerNoteParam', () => {
    const makeStore = () => {
        const store = createGrandBouleStore(`test-${Math.random()}`);
        store.set(createDefaultGrandBouleState());
        return store;
    };

    const drive = (perNoteMap: GrandBoulePerNoteMap, key: number, param: 'hammerHardness', value: number) => {
        const store = makeStore();
        let captured: GrandBoulePerNoteMap = perNoteMap;
        setGrandBoulePerNoteParam({
            engine: createDisconnectedGrandBouleEngineHandle(),
            key,
            param,
            value,
            perNoteMap,
            setPerNoteMap: (next) => {
                captured = next;
            },
            store,
        });
        return captured;
    };

    it('retains the key when a value deviates from default', () => {
        const result = drive(new Map(), 40, 'hammerHardness', 1.5);
        expect(result.has(40)).toBe(true);
        expect(result.get(40)?.hammerHardness).toBe(1.5);
    });

    it('drops the key from the map when the only edited field is set back to its default', () => {
        // Pre-existing entry that already deviates from default.
        const seeded: GrandBoulePerNoteMap = new Map([[40, { ...createDefaultPerNoteValues(), hammerHardness: 1.5 }]]);

        // Knob the single deviating field back to its default (1.0). The
        // resulting object is functionally default, so the entry must NOT
        // linger in the map — otherwise hasOverrides false-positives.
        const result = drive(seeded, 40, 'hammerHardness', 1.0);
        expect(result.has(40)).toBe(false);
    });

    it('does not insert a functionally-default entry for an untouched key', () => {
        // Setting a knob to its existing default on a key with no prior
        // override must leave the map empty, not seeded with all-default values.
        const result = drive(new Map(), 55, 'hammerHardness', 1.0);
        expect(result.has(55)).toBe(false);
        expect(result.size).toBe(0);
    });

    it('clamps the value to the descriptor range before storing', () => {
        // hammerHardness max is 2.0.
        const result = drive(new Map(), 40, 'hammerHardness', 99);
        expect(result.get(40)?.hammerHardness).toBe(2.0);
    });

    it('dispatches the clamped value to the engine under the per-note name', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        const setParam = vi.spyOn(engine, 'setParam');
        const store = makeStore();
        setGrandBoulePerNoteParam({
            engine,
            key: 40,
            param: 'hammerHardness',
            value: 1.5,
            perNoteMap: new Map(),
            setPerNoteMap: () => {},
            store,
        });
        expect(setParam).toHaveBeenCalledWith({ name: 'perNote.40.hammerHardness', value: 1.5 });
    });
});
