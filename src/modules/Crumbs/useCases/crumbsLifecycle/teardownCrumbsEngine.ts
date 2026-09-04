import { destroyCrumbsInstance } from '../../repositories/crumbsBridge/destroyCrumbsInstance';
import { removeInstance } from '../../stores/crumbsStore';
import { removePadInstance } from '../../stores/padStore';
import { removeSliceInstance } from '../../stores/sliceStore';

export async function teardownCrumbsEngine(instanceId: string): Promise<void> {
    removeInstance(instanceId);
    removePadInstance(instanceId);
    removeSliceInstance(instanceId);
    await destroyCrumbsInstance(instanceId);
}
