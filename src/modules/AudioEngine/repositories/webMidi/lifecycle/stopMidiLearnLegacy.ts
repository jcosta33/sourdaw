import { midiLearn } from '../state';

export function stopMidiLearnLegacy(): void {
    midiLearn.active = false;
    midiLearn.callback = null;
}