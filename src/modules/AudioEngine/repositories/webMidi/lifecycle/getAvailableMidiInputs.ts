import { type MidiInputInfo } from '#/modules/AudioEngine/models/WebMidiTypes';
import { getState } from '../state';

export function getAvailableMidiInputs(): MidiInputInfo[] {
    return getState().inputs;
}