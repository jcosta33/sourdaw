import { notifyUser } from '#/utils/Notification/notifyUser';
import { createHandler } from '#/utils/createHandler';
import { detectKey } from '#/modules/AudioAnalysis/useCases';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleDetectKey = createHandler<'detectKey'>({
    execute: (a) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((t) => t.clips)
            .find((c) => c.id === a.payload.clipId);
        if (clip?.audioBufferId) {
            const result = detectKey(clip.audioBufferId);
            if (result) {
                const conf = Math.round(result.confidence * 100);
                notifyUser(`Detected key: ${result.key} ${result.mode} (${conf}% confidence)`);
            } else {
                notifyUser('Could not detect key');
            }
        }
    },
    describe: () => ({ label: 'Detect key from audio' }),
    undoable: false,
});
