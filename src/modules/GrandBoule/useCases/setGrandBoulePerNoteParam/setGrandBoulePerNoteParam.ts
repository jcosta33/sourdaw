import { type Store } from '#/infra/store/types';

import {
    type GrandBoulePerNoteValues,
    type GrandBoulePerNoteMap,
    createDefaultPerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
} from '../../models/GrandBoulePerNoteParams';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

/**
 * True when every field of `values` equals the neutral per-note default.
 * Used to decide whether a key carries a real override or should drop out
 * of the override map entirely.
 */
function isDefaultPerNoteValues(values: GrandBoulePerNoteValues): boolean {
    const defaults = createDefaultPerNoteValues();
    return (Object.keys(defaults) as (keyof GrandBoulePerNoteValues)[]).every(
        (field) => values[field] === defaults[field]
    );
}

type SetGrandBoulePerNoteParamInput = {
    engine: GrandBouleEngineHandle;
    /** Piano key number 1–88. */
    key: number;
    /** Parameter name to update. */
    param: keyof GrandBoulePerNoteValues;
    /** New value (will be clamped to the descriptor range). */
    value: number;
    /** Mutable per-note map from the parent component state. */
    perNoteMap: GrandBoulePerNoteMap;
    /** Setter for the per-note map. */
    setPerNoteMap: (next: GrandBoulePerNoteMap) => void;
    store: Store<GrandBouleState>;
};

export function setGrandBoulePerNoteParam(input: SetGrandBoulePerNoteParamInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }

    const descriptor = PER_NOTE_PARAM_DESCRIPTORS.find((d) => d.key === input.param);
    if (descriptor === undefined) {
        return;
    }

    const clamped = Math.max(descriptor.min, Math.min(descriptor.max, input.value));

    // Update the per-note map (immutable copy)
    const existing = input.perNoteMap.get(input.key) ?? createDefaultPerNoteValues();
    const updated: GrandBoulePerNoteValues = { ...existing, [input.param]: clamped };

    const next = new Map(input.perNoteMap);
    // Only retain a map entry when at least one field actually deviates from
    // the neutral defaults. Writing the whole default object on a single-knob
    // edit (or knobbing a value back to its default) would otherwise leave a
    // functionally-default entry in the map, falsely signalling an override.
    if (isDefaultPerNoteValues(updated)) {
        next.delete(input.key);
    } else {
        next.set(input.key, updated);
    }
    input.setPerNoteMap(next);

    // Dispatch to engine with per-note naming convention
    input.engine.setParam({
        name: `perNote.${input.key}.${input.param}`,
        value: clamped,
    });
}
