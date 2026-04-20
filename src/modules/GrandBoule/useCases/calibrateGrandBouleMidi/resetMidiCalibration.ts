import { type Store } from '#/infra/store/types';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleState } from '../../stores/grandBouleStore';

// --- Bulk operations --------------------------------------------------------

export const resetMidiCalibration = (input: { store: Store<GrandBouleState> }): void => {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    input.store.set({
        ...state,
        midiCalibration: createDefaultMidiCalibration(),
    });
};
