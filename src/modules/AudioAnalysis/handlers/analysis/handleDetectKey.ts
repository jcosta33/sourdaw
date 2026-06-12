import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { detectKey } from '../../useCases/keyDetection';

export const handleDetectKey = createHandler<'detectKey'>({
    execute: (action) => {
        const clip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip?.audioBufferId) {
            return;
        }

        const result = detectKey(clip.audioBufferId);
        if (!result) {
            notifyUser('Could not detect key');
            return;
        }

        const confidencePercent = Math.round(result.confidence * 100);
        notifyUser(`Detected key: ${result.key} ${result.mode} (${confidencePercent}% confidence)`);
    },
    describe: () => ({ label: 'Detect key from audio' }),
    undoable: false,
});
