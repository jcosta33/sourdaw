import { midiLearn } from '../state';

export function startMidiLearnLegacy(callback: (cc: number, channel: number) => void): void {
    midiLearn.active = true;
    midiLearn.callback = callback;
}
