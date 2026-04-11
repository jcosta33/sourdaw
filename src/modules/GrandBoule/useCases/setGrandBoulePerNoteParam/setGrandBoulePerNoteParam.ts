import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';

import {
    type GrandBoulePerNoteValues,
    type GrandBoulePerNoteMap,
    createDefaultPerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
} from '../../models/GrandBoulePerNoteParams';

import { grandBouleStore } from '../../stores/grandBouleStore';

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