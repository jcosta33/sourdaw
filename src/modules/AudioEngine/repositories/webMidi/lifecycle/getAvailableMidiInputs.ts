import { type MidiInputInfo } from '../../../models/WebMidiTypes';
import { getState } from '../getState';

export function getAvailableMidiInputs(): MidiInputInfo[] {
    return getState().inputs;
}
