import { createStore } from '#/infra/store/createStore';

export type StepRecordState = {
    active: boolean;
    clipId: string | null;
    currentBeat: number;
    currentPitch: number; // For keyboard-only entry cursor
    stepSize: number; // grid division, e.g. 0.25 for 1/16
    velocity: number;
    quantizeToScale: boolean; // if true, notes played will snap to the nearest scale degree
    advanceOnNoteOff: boolean; // standard mode: advance when all notes are released
    activeNotes: Set<number>; // currently held MIDI pitches
};

export const defaultStepRecordState: StepRecordState = {
    active: false,
    clipId: null,
    currentBeat: 0,
    currentPitch: 60,
    stepSize: 0.25,
    velocity: 100,
    quantizeToScale: true,
    advanceOnNoteOff: true,
    activeNotes: new Set<number>(),
};

export const stepRecordStore = createStore<StepRecordState>({
    initialData: defaultStepRecordState,
});
