import { tauriInvoke } from '#/utils/tauriBridge';

import { getMidiAccess } from '../getMidiAccess';
import { getTauriEventUnlisten } from '../getTauriEventUnlisten';
import { getTauriMode } from '../getTauriMode';
import { releaseAllActiveNotes } from '../releaseAllActiveNotes';
import { resetChannelControllerState } from '../resetChannelControllerState';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTargetTrackId } from '../setTargetTrackId';
import { setTauriEventUnlisten } from '../setTauriEventUnlisten';
import { setTauriMode } from '../setTauriMode';
import { midiLearn } from '../state';

import { detachActiveInput } from './detachActiveInput';

import type { GetWebMidiTrackStrip } from '../engineStripAccess';

export function destroyWebMidi(getTrackStrip: GetWebMidiTrackStrip): void {
    detachActiveInput();

    if (getTauriMode()) {
        const unlisten = getTauriEventUnlisten();
        if (unlisten) {
            unlisten();
            setTauriEventUnlisten(null);
        }
        tauriInvoke('close_midi_input').catch(() => {});
        setTauriMode(false);
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
