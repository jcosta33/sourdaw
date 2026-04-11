import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { grandBouleStore } from '../../stores/grandBouleStore';

// --- Bulk operations --------------------------------------------------------

export const resetMidiCalibration = (): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        midiCalibration: createDefaultMidiCalibration(),
    });
};