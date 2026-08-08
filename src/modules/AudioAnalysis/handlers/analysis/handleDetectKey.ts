import { trackStore } from '#/modules/Arrangement/stores';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { describeDetectedKey } from '../../useCases/describeDetectedKey';
import { detectKey } from '../../useCases/keyDetection';

export const handleDetectKey = createHandler<'detectKey'>({
    execute: (action) => {
        const clip = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip?.audioBufferId) {
            return;
        }

        notifyUser(describeDetectedKey(detectKey(clip.audioBufferId)));
    },
    describe: () => ({ label: 'Detect key from audio' }),
    undoable: false,
});
