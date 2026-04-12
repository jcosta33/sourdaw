import { tauriInvoke } from '#/utils/tauriBridge';

import {
    getMidiAccess,
    getActiveInput,
    getTauriMode,
    getTauriEventUnlisten,
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
    const input = getActiveInput();
    if (input) {
        input.onmidimessage = null;
        setActiveInput(null);
    }

    if (getTauriMode()) {
        const unlisten = getTauriEventUnlisten();
        if (unlisten) {
            unlisten();
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