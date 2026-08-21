import { stopCrumbsRecordFeed } from '#/modules/AudioEngine/useCases';

import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';

export async function stopCrumbsRecording(instanceId: string): Promise<void> {
    // Disarm the producer first so no straggler monitored block reaches the
    // bridge after the native stop closes the take. Idempotent.
    stopCrumbsRecordFeed();
    await stopRecording(instanceId);
}
