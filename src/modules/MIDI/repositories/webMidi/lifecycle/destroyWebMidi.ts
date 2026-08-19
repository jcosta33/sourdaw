import { desktopInvoke } from '#/utils/desktopBridge';

import { getMidiAccess } from '../getMidiAccess';
import { getNativeEventUnlisten } from '../getNativeEventUnlisten';
import { getNativeMode } from '../getNativeMode';
import { releaseAllActiveNotes } from '../releaseAllActiveNotes';
import { resetChannelControllerState } from '../resetChannelControllerState';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTargetTrackId } from '../setTargetTrackId';
import { setNativeEventUnlisten } from '../setNativeEventUnlisten';
import { setNativeMode } from '../setNativeMode';
import { midiLearn } from '../state';

import { detachActiveInput } from './detachActiveInput';

import type { GetWebMidiTrackStrip } from '../engineStripAccess';

/**
 * Full teardown of the live MIDI input: detach, close the native handle, release
 * every held voice, disarm MIDI learn, and drop the discovered input list.
 *
 * No production caller reaches this today — the only exercise is its own spec
 * (issue #1837 F6). It is kept rather than deleted because it is the sole caller
 * of the `close_midi_input` native command, so deleting it would drop the only
 * path that releases the native device. Wiring it to a real teardown lifecycle
 * (app shutdown, or a MIDI-disable toggle) is an open decision.
 */
export function destroyWebMidi(getTrackStrip: GetWebMidiTrackStrip): void {
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
    releaseAllActiveNotes({ getTrackStrip });
    resetChannelControllerState();

    const access = getMidiAccess();
    if (access) {
        access.onstatechange = null;
        setMidiAccess(null);
    }

    midiLearn.active = false;
    midiLearn.callback = null;
    setTargetTrackId(null);

    setState({
        inputs: [],
        selectedInputId: null,
    });
}
