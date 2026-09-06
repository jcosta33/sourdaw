import { getActiveInput } from '../getActiveInput';
import { releaseAllActiveNotes } from '../releaseAllActiveNotes';
import { resetChannelControllerState } from '../resetChannelControllerState';
import { sendPanicToMidiOutputs } from '../sendPanicToMidiOutputs';

import type { GetWebMidiTrackStrip, ReleaseNativeLiveNote } from '../engineStripAccess';

/**
 * Return the live MIDI input to a clean slate: release every held voice, drop
 * the decoded controller state, and tell downstream hardware to do the same.
 *
 * The release itself is `releaseAllActiveNotes` rather than a list kept here —
 * this path used to release Toaster pads and raw oscillators only, and cleared
 * the note map on top, so a Fermenter / Grand Boule / Levain voice was left
 * sounding with nothing left that knew about it (audit MD-6).
 */
export function resetMidiState(deps: {
    getCurrentTime: () => number;
    getTrackStrip: GetWebMidiTrackStrip;
    releaseNativeNote: ReleaseNativeLiveNote;
}): void {
    releaseAllActiveNotes(deps);
    // Latched 14-bit halves and a declared RPN 0 bend range describe the
    // controller, not the project (audit MD-7, MD-8).
    resetChannelControllerState();

    if (getActiveInput()) {
        sendPanicToMidiOutputs();
    }
}
