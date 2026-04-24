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
    undoable: true,
});
