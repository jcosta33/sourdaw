import { type GrandBouleMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { grandBouleStore } from '../../stores/grandBouleStore';
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const updateCalibration = (patch: Partial<GrandBouleMidiCalibration>): void => {
    const state = grandBouleStore.value;
    if (state === null) {
        return;
    }
    grandBouleStore.set({
        ...state,
        midiCalibration: { ...state.midiCalibration, ...patch },
    });
};