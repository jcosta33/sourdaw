import { audioEngine } from '#/modules/AudioEngine/useCases';

import { releaseAllActiveNotes } from '../../repositories/webMidi/releaseAllActiveNotes';
import { sendPanicToMidiOutputs } from '../../repositories/webMidi/sendPanicToMidiOutputs';

import { releaseNativeLiveNote } from './releaseNativeLiveNote';

type PanicLiveNotesInput = {
    /**
     * Whether to broadcast the channel-mode panic to connected outputs.
     *
     * False when the panic was itself triggered by an incoming All Sound Off /
     * All Notes Off: the sender already knows, and echoing it back out would
     * loop forever through a loopback port that feeds our own input.
     */
    notifyOutputs?: boolean;
};

/**
 * Release every voice the live MIDI input is holding and tell downstream
 * hardware to do the same (audit MD-6).
 *
 * This is the live half of a panic: the notes this app knows are held, plus the
 * channel-mode broadcast for the ones it does not. It is invoked both by the
 * user-facing panic and by an incoming All Sound Off / All Notes Off from the
 * controller itself, which had no effect at all before.
 */
export function panicLiveNotes({ notifyOutputs = true }: PanicLiveNotesInput = {}): void {
    releaseAllActiveNotes({
        getCurrentTime: () => audioEngine.context.currentTime,
        getTrackStrip: (trackId) => audioEngine.getTrackStrip(trackId),
        releaseNativeNote: releaseNativeLiveNote,
    });
    if (notifyOutputs) {
        sendPanicToMidiOutputs();
    }
}
