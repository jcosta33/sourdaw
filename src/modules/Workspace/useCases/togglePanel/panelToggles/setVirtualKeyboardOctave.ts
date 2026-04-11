import { updateWorkspaceState } from '../../../repositories/workspace';

export function setVirtualKeyboardOctave(octave: number): void {
    updateWorkspaceState({ virtualKeyboardOctave: Math.max(0, Math.min(8, octave)) });
}