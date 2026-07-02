import { MIDI_CC } from '../../../models/WebMidiTypes';
import { audioEngine } from '../../createWebAudioEngine';
import { getActiveInput } from '../getActiveInput';
import { getMidiAccess } from '../getMidiAccess';
import { activeNotes, channelToNote } from '../state';

export function resetMidiState(): void {
    for (const [, noteData] of activeNotes) {
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
