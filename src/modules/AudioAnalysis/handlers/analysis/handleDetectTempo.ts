import { trackStore } from '#/modules/Arrangement/stores';
import { detectProjectTempo } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectTempo as detectTempoFromBuffer } from '../../useCases/tempoDetection';

export const handleDetectTempo = createHandler<'detectTempo'>({
    execute: (action) => {
        const clip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (clip?.audioBufferId) {
            const bpm = detectTempoFromBuffer(clip.audioBufferId);
            if (bpm) {
                notifyUser(`Detected tempo: ${bpm} BPM`);
            } else {
                notifyUser('Could not detect tempo');
            }
            return;
        }

        const result = detectProjectTempo();
        if (result.confidence > 0.5) {
            notifyUser(`Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`, 'success');
            return;
        }

        notifyUser('Could not confidently detect tempo — add more content first', 'warning');
    },
    describe: () => ({ label: 'Detect tempo' }),
    undoable: true,
});
