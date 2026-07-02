import { tauriInvoke } from '#/utils/tauriBridge';

import { getMidiAccess } from '../getMidiAccess';
import { getTauriEventUnlisten } from '../getTauriEventUnlisten';
import { getTauriMode } from '../getTauriMode';
import { setMidiAccess } from '../setMidiAccess';
import { setState } from '../setState';
import { setTargetTrackId } from '../setTargetTrackId';
import { setTauriEventUnlisten } from '../setTauriEventUnlisten';
import { setTauriMode } from '../setTauriMode';
import { activeNotes, channelToNote, midiLearn } from '../state';

import { detachActiveInput } from './detachActiveInput';

export function destroyWebMidi(): void {
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
