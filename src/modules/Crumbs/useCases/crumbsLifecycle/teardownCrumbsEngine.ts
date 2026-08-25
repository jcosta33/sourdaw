import { stopCrumbsRecordFeed } from '#/modules/AudioEngine/useCases';

import { destroyCrumbsInstance } from '../../repositories/crumbsBridge/destroyCrumbsInstance';
import { removeInstance } from '../../stores/crumbsStore';
import { removePadInstance } from '../../stores/padStore';
import { removeSliceInstance } from '../../stores/sliceStore';

export async function teardownCrumbsEngine(instanceId: string): Promise<void> {
    // Disarm the record feed before the instance's bridge is destroyed: the
    // shared tap would otherwise post per-quantum IPC into a map with no
    // consumer for this instance until app close. Stopping by instance id
    // keeps the tap alive for any other still-armed instance.
    stopCrumbsRecordFeed(instanceId);
    removeInstance(instanceId);
    removePadInstance(instanceId);
    removeSliceInstance(instanceId);
    await destroyCrumbsInstance(instanceId);
}
