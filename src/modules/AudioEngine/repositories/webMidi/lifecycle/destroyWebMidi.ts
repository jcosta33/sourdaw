import { tauriInvoke } from '#/helpers/tauriBridge';

import {
    midiAccess,
    activeInput,
    tauriMode,
    tauriEventUnlisten,
    activeNotes,
    channelToNote,
    midiLearn,
    setState,
    setMidiAccess,
    setActiveInput,
    setTauriMode,
    setTauriEventUnlisten,
    setTargetTrackId,
} from '../state';

export function destroyWebMidi(): void {
    if (activeInput) {
        activeInput.onmidimessage = null;
        setActiveInput(null);
    }

    if (tauriMode) {
        if (tauriEventUnlisten) {
            tauriEventUnlisten();
            setTauriEventUnlisten(null);
        }
        tauriInvoke('close_midi_input').catch(() => {});
        setTauriMode(false);
    }

    for (const noteData of activeNotes.values()) {
        if (noteData.osc) {
            try {
                noteData.osc.stop();
            } catch {
                // already stopped
            }
        }
    }
    activeNotes.clear();
    channelToNote.clear();

    if (midiAccess) {
        midiAccess.onstatechange = null;
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