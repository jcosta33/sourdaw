import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { detectKey } from '#/modules/AudioAnalysis';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import type { ExtractAction } from '../types';

export const executeDetectKey = inject({ getTrackStoreState, detectKey, notifyUser })(
    ({ getTrackStoreState, detectKey, notifyUser }) =>
        function executeDetectKey(a: ExtractAction<AppAction, 'detectKey'>): void {
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
        }
);

export const handleDetectKey = createHandler<'detectKey'>({
    execute: executeDetectKey,
    describe: () => ({ label: 'Detect key from audio' }),
    undoable: false,
});
