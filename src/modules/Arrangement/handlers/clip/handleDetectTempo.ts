import { notifyUser } from '#/utils/Notification/notifyUser';
import { createHandler } from '#/utils/createHandler';
import { detectTempo as detectTempoFromBuffer } from '#/modules/AudioAnalysis/useCases';
import { detectProjectTempo } from '#/modules/Transport/useCases';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleDetectTempo = createHandler<'detectTempo'>({
    execute: (a) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((t) => t.clips)
            .find((c) => c.id === a.payload.clipId);
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
        notifyUser(
            result.confidence > 0.5
                ? `Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`
                : 'Could not confidently detect tempo — add more content first',
            result.confidence > 0.5 ? 'success' : 'warning'
        );
    },
    describe: () => ({ label: 'Detect tempo' }),
    undoable: true,
});
