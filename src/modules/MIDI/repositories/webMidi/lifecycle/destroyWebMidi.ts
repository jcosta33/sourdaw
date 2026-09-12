import { desktopInvoke } from '#/utils/desktopBridge';

import { getMidiAccess } from '../getMidiAccess';
import { getNativeEventUnlisten } from '../getNativeEventUnlisten';
import { getNativeMode } from '../getNativeMode';
import { releaseAllActiveNotes } from '../releaseAllActiveNotes';
import { resetChannelControllerState } from '../resetChannelControllerState';
import { setMidiAccess } from '../setMidiAccess';
import { setNativeEventUnlisten } from '../setNativeEventUnlisten';
import { setNativeMode } from '../setNativeMode';
import { setState } from '../setState';
import { setTargetTrackId } from '../setTargetTrackId';
import { midiLearn } from '../state';

import { detachActiveInput } from './detachActiveInput';

import type { GetWebMidiTrackStrip, ReleaseNativeLiveNote } from '../engineStripAccess';

/**
 * Full teardown of the live MIDI input: detach, close the native handle,
 * release every held voice, disarm MIDI learn, and drop the discovered input
 * list.
 *
 * Wired to the app's `beforeunload` teardown via the `destroyWebMidi` use case
 * (#2016), which injects the strip access and the native-note release. The
 * `close_midi_input` command it invokes has one other production caller: the
 * name-mismatch backout in `selectMidiInputNative`, so the command must stay.
 */
export function destroyWebMidi(input: {
    getTrackStrip: GetWebMidiTrackStrip;
    releaseNativeNote: ReleaseNativeLiveNote;
}): void {
    detachActiveInput();

    if (getNativeMode()) {
        const unlisten = getNativeEventUnlisten();
        if (unlisten) {
            unlisten();
            setNativeEventUnlisten(null);
        }
        desktopInvoke('close_midi_input').catch(() => {});
        setNativeMode(false);
    }

    // Same release core as reset and panic (audit MD-6). Teardown used to stop
    // Toaster pads and raw oscillators only, so a Fermenter / Grand Boule /
    // Levain voice held at teardown kept sounding.
    releaseAllActiveNotes(input);
    resetChannelControllerState();

    const access = getMidiAccess();
    if (access) {
        access.onstatechange = null;
        setMidiAccess(null);
    }

    midiLearn.active = false;
    midiLearn.callback = null;
    setTargetTrackId(null);

    // Teardown never touches the user's saved preference: dropping the
    // selected id here would persist `null` and erase the device the next
    // launch should restore — the same rule the hot-unplug stand-in follows.
    setState(
        {
            inputs: [],
            selectedInputId: null,
        },
        { persistSelection: false }
    );
}
