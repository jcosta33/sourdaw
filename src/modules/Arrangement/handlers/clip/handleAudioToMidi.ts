import { createHandler } from '#/utils/createHandler';
import { audioToMidi } from '#/modules/AudioAnalysis/useCases';

export const handleAudioToMidi = createHandler<'audioToMidi'>({
    execute: (a) => {
        audioToMidi({
            clipId: a.payload.clipId,
            trackId: a.payload.trackId ?? '',
            sensitivity: a.payload.sensitivity,
            mode: (a.payload.mode as 'rhythm' | 'pitched') ?? 'rhythm',
        });
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
