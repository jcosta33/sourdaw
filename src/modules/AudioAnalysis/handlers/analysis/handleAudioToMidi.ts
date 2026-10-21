import { createHandler } from '#/utils/createHandler';

import { audioToMidi } from '../../useCases/audioToMidi';

function normalizeAudioToMidiMode(mode: string | undefined): 'rhythm' | 'pitched' {
    if (mode === 'pitched') {
        return 'pitched';
    }

    return 'rhythm';
}

export const handleAudioToMidi = createHandler<'audioToMidi'>({
    executionKind: 'runtime',
    execute: async (action) => {
        const converted = await audioToMidi({
            clipId: action.payload.clipId,
            trackId: action.payload.trackId ?? '',
            sensitivity: action.payload.sensitivity,
            mode: normalizeAudioToMidiMode(action.payload.mode),
        });
        return { status: converted ? 'written' : 'no-write' };
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    // The orchestration itself writes nothing. Its grouped child commands own
    // the complete track/clip/note inverse and run outside a parent project transaction.
    undoable: false,
});
