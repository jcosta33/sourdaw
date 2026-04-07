/**
 * Update a single per-note physical parameter for the Grand Boule piano.
 *
 * Writes the new value into the per-note map on the store and dispatches
 * to the engine via `setParam` using the naming convention
 * `perNote.{key}.{param}` (§3.1).
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import {
    type GrandBoulePerNoteValues,
    type GrandBoulePerNoteMap,
    createDefaultPerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
} from '../models/GrandBoulePerNoteParams';
import { grandBouleStore } from '../stores/grandBouleStore';

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
};

export const setGrandBoulePerNoteParam = (input: SetGrandBoulePerNoteParamInput): void => {
    const state = grandBouleStore.value;
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
    next.set(input.key, updated);
    input.setPerNoteMap(next);

    // Dispatch to engine with per-note naming convention
    input.engine.setParam({
        name: `perNote.${input.key}.${input.param}`,
        value: clamped,
    });
};

type ResetGrandBoulePerNoteParamsInput = {
    engine: GrandBouleEngineHandle;
    /** Piano key number 1–88. */
    key: number;
    /** Mutable per-note map from the parent component state. */
    perNoteMap: GrandBoulePerNoteMap;
    /** Setter for the per-note map. */
    setPerNoteMap: (next: GrandBoulePerNoteMap) => void;
};

/** Reset all per-note parameters for a given key back to defaults. */
export const resetGrandBoulePerNoteParams = (input: ResetGrandBoulePerNoteParamsInput): void => {
    const defaults = createDefaultPerNoteValues();

    const next = new Map(input.perNoteMap);
    next.delete(input.key);
    input.setPerNoteMap(next);

    // Dispatch all default values to the engine
    for (const descriptor of PER_NOTE_PARAM_DESCRIPTORS) {
        input.engine.setParam({
            name: `perNote.${input.key}.${descriptor.key}`,
            value: defaults[descriptor.key],
        });
    }
};
