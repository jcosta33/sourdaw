import { audioToMidi } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleAudioToMidi = createHandler<'audioToMidi'>({
    execute: (alpha) => {
        audioToMidi({
            clipId: alpha.payload.clipId,
            trackId: alpha.payload.trackId ?? '',
            sensitivity: alpha.payload.sensitivity,
            mode: (alpha.payload.mode as 'rhythm' | 'pitched') ?? 'rhythm',
        });
    },
    describe: () => ({ label: 'Convert audio to MIDI' }),
    undoable: true,
});
