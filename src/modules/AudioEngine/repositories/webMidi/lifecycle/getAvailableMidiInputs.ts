import { type MidiInputInfo } from '../../../models/WebMidiTypes';
import { getState } from '../state';

export function getAvailableMidiInputs(): MidiInputInfo[] {
    return getState().inputs;
}