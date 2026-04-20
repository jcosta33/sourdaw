import { type Store } from '#/infra/store/types';

import {
    type GrandBoulePerNoteMap,
    createDefaultPerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
} from '../../models/GrandBoulePerNoteParams';
import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

type ResetGrandBoulePerNoteParamsInput = {
    engine: GrandBouleEngineHandle;
    /** Piano key number 1–88. */
    key: number;
    /** Mutable per-note map from the parent component state. */
    perNoteMap: GrandBoulePerNoteMap;
    /** Setter for the per-note map. */
    setPerNoteMap: (next: GrandBoulePerNoteMap) => void;
    store: Store<GrandBouleState>;
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
