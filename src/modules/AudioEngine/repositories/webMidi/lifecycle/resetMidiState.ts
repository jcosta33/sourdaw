import { MIDI_CC } from '../../../models/WebMidiTypes';
import { getMidiAccess, getActiveInput, activeNotes, channelToNote } from '../state';
import { audioEngine } from '../../createWebAudioEngine';

export function resetMidiState(): void {
    for (const [note, noteData] of activeNotes) {
        if (noteData.osc) {
            const now = audioEngine.context.currentTime;
            if (noteData.osc._env) {
                noteData.osc._env.gain.setTargetAtTime(0, now, 0.005);
            }
            try {
                noteData.osc.stop(now + 0.02);
            } catch {
                // already stopped
            }
        }
        note;
    }
    activeNotes.clear();
    channelToNote.clear();

    const access = getMidiAccess();
    if (getActiveInput() && access) {
        const output = access.outputs.values().next().value;
        if (output) {
            for (let ch = 0; ch < 16; ch++) {
                output.send([MIDI_CC | ch, 120, 0]);
                output.send([MIDI_CC | ch, 121, 0]);
            }
        }
    }
}