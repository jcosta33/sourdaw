import { createHandler } from '#/utils/createHandler';

import { audioToMidi } from '../../useCases/audioToMidi';

function normalizeAudioToMidiMode(mode: string | undefined): 'rhythm' | 'pitched' {
    if (mode === 'pitched') {
        return 'pitched';
    }

    return 'rhythm';
}

export const handleAudioToMidi = createHandler<'audioToMidi'>({
    execute: (action) => {
        audioToMidi({
            clipId: action.payload.clipId,
            trackId: action.payload.trackId ?? '',
            sensitivity: action.payload.sensitivity,
            mode: normalizeAudioToMidiMode(action.payload.mode),
        });
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    // Not undoable: the conversion's MIDI clip and notes are written through direct
    // `addClip` / `addMidiNote` store calls (see useCases/audioToMidi.ts), not dispatched
    // AppActions, so this handler has no `inverseAction` to honor. Marking it `undoable: true`
    // would push an inert undo entry (null inverse) that `executeUndo` cannot consume — it
    // would wedge the undo stack (undoRedo.ts:23-38,107-112) on a no-op. The track creation it
    // performs is dispatched as its own `addTrack` AppAction and stays independently undoable.
    undoable: false,
});
