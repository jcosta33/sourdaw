import { CC_ALL_NOTES_OFF, CC_ALL_SOUND_OFF, CC_RESET_ALL_CONTROLLERS } from '../../models/MidiControllerState';
import { MIDI_CC } from '../../models/WebMidiTypes';

import { getMidiAccess } from './getMidiAccess';

const MIDI_CHANNEL_COUNT = 16;

/**
 * Broadcast All Sound Off / Reset All Controllers / All Notes Off on every
 * channel of every connected MIDI output (audit MD-6).
 *
 * A hanging voice is often in *hardware* downstream of us — a synth we echoed a
 * note-on to whose note-off was lost. Releasing our own engines does nothing
 * for it; only the channel-mode broadcast does. All outputs, not just the
 * first: which one is holding the note is not knowable from here.
 */
export function sendPanicToMidiOutputs(): void {
    const access = getMidiAccess();
    if (!access) {
        return;
    }
    for (const output of access.outputs.values()) {
        for (let channel = 0; channel < MIDI_CHANNEL_COUNT; channel++) {
            output.send([MIDI_CC | channel, CC_ALL_SOUND_OFF, 0]);
            output.send([MIDI_CC | channel, CC_RESET_ALL_CONTROLLERS, 0]);
            output.send([MIDI_CC | channel, CC_ALL_NOTES_OFF, 0]);
        }
    }
}
