import { stopCrumbsRecordFeed } from '#/modules/AudioEngine/useCases';

import { stopRecording } from '../../repositories/crumbsBridge/stopRecording';

export async function stopCrumbsRecording(instanceId: string): Promise<void> {
    // Disarm this instance's producer first so no straggler monitored block
    // reaches the bridge after the native stop closes the take. The shared
    // tap stays up for any other still-armed instance.
    stopCrumbsRecordFeed(instanceId);
    await stopRecording(instanceId);
}
