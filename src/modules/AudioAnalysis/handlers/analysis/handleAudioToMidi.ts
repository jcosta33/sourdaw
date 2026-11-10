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
    batchExecution: 'singleton',
    execute: async (action, context) => {
        const converted = await audioToMidi({
            clipId: action.payload.clipId,
            trackId: action.payload.trackId ?? '',
            sensitivity: action.payload.sensitivity,
            mode: normalizeAudioToMidiMode(action.payload.mode),
            signal: context?.signal,
        });
        return { status: converted ? 'written' : 'no-write' };
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    // The child batch owns creation and its complete inverse, outside any parent
    // project transaction. The runtime orchestrator publishes no history of its own.
    undoable: false,
});
