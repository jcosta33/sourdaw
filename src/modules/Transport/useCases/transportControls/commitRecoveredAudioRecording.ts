import { logger } from '#/infra/logger/appLogger';
import { commitRecording, prepareRecoveredRecording } from '#/modules/Arrangement/useCases';
import { ensureCachedAudioBuffersDurable } from '#/modules/AudioEngine/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { recordingLifecycle } from './recordingLifecycle';

async function retainRecoveredPcm(bufferId: string): Promise<void> {
    try {
        const receipt = await ensureCachedAudioBuffersDurable([bufferId]);
        if (receipt.status !== 'durable') {
            throw new Error(`Recovered audio persistence ${receipt.status}`);
        }
        try {
            if (!receipt.isCurrent()) {
                throw new Error('Recovered audio persistence was superseded');
            }
        } finally {
            receipt.release();
        }
    } catch (error: unknown) {
        // The semantic entry already exists. A storage failure must never flow
        // through a capture-failure handler and discard this clip or its PCM.
        logger.error(new Error('Recovered audio could not be made durable', { cause: error }));
        notifyUser(
            'The muted recording is still in this project, but its audio could not be saved. Keep the project open and try saving again.',
            'error'
        );
    }
}

/** A finite terminal outcome; this says kept, never already saved. */
export function commitRecoveredAudioRecording(
    clip: Parameters<typeof prepareRecoveredRecording>[0],
    endBeat: number,
    shouldExecute?: () => boolean
): Promise<void | 'refused'> {
    if (shouldExecute?.() === false) {
        return Promise.resolve('refused');
    }
    const recovered = prepareRecoveredRecording(clip, endBeat);
    if (!recovered || !recovered.audioBufferId) {
        return Promise.resolve();
    }
    const bufferId = recovered.audioBufferId;
    const closing = commitRecording(recovered, undefined, { shouldExecute })
        .then(() => {
            notifyUser('Audio kept as a muted recording. Align it before playback, then save your project.', 'warning');
            return retainRecoveredPcm(bufferId);
        })
        .catch((error: unknown) => {
            if (error instanceof Error && error.name === 'RecordingRootMovedRefusal') {
                notifyUser(
                    'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
                    'warning'
                );
                return 'refused' as const;
            }
            logger.error(new Error('Recovered recording could not be committed', { cause: error }));
            notifyUser(
                'The recovered audio could not be added to this project. Keep the project open and try saving again.',
                'error'
            );
            return undefined;
        });
    recordingLifecycle.trackCommit(closing);
    return closing;
}
