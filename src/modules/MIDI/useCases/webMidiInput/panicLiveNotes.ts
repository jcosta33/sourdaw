import { audioEngine } from '#/modules/AudioEngine/useCases';

import { releaseAllActiveNotes } from '../../repositories/webMidi/releaseAllActiveNotes';
import { sendPanicToMidiOutputs } from '../../repositories/webMidi/sendPanicToMidiOutputs';

/**
 * Release every voice the live MIDI input is holding and tell downstream
 * hardware to do the same (audit MD-6).
 *
 * This is the live half of a panic: the notes this app knows are held, plus the
 * channel-mode broadcast for the ones it does not. It is invoked both by the
 * user-facing panic and by an incoming All Sound Off / All Notes Off from the
 * controller itself, which had no effect at all before.
 */
export function panicLiveNotes(): void {
    releaseAllActiveNotes({
        getCurrentTime: () => audioEngine.context.currentTime,
        getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
    });
    sendPanicToMidiOutputs();
}
