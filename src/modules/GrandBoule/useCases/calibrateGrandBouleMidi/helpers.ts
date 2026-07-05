import { type Store } from '#/infra/store/types';

import { type GrandBouleMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { type GrandBouleState } from '../../stores/grandBouleStore';

export function updateCalibration(store: Store<GrandBouleState>, patch: Partial<GrandBouleMidiCalibration>): void {
    const state = store.value;
    if (state === null) {
        return;
    }
    store.set({
        ...state,
        midiCalibration: { ...state.midiCalibration, ...patch },
    });
}
