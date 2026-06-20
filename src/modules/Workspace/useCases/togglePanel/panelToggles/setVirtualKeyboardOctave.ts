import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const setVirtualKeyboardOctave = (octave: number): void => {
    updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
};
