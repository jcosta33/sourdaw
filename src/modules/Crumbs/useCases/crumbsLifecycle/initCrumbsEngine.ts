import { createCrumbsInstance } from '../../repositories/crumbsBridge';
import { ensureInstance } from '../../stores/crumbsStore';
import { ensurePadInstance } from '../../stores/padStore';
import { ensureSliceInstance } from '../../stores/sliceStore';

export async function initCrumbsEngine(instanceId: string, sampleRate: number): Promise<void> {
    ensureInstance(instanceId);
    ensurePadInstance(instanceId);
    ensureSliceInstance(instanceId);
    await createCrumbsInstance(instanceId, sampleRate);
}