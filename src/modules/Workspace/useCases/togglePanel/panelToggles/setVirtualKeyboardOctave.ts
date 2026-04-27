import { updateWorkspaceState } from '../../../repositories/workspace';

export const setVirtualKeyboardOctave = (octave: number): void => {
    updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
};
