import { createCrumbsInstance } from '../../repositories/crumbsBridge/createCrumbsInstance';
import { removeInstance } from '../../stores/crumbsStore';
import { ensurePadInstance, removePadInstance } from '../../stores/padStore';
import { ensureSliceInstance, removeSliceInstance } from '../../stores/sliceStore';

import { ensureCrumbsInstanceFromProject } from './ensureCrumbsInstanceFromProject';

/**
 * Ensures the per-instance stores, then creates the backend crumbs engine.
 *
 * If {@link createCrumbsInstance} rejects mid-init, the stores ensured here are
 * rolled back so the UI falls back to its typed defaults instead of presenting a
 * populated-but-dead instance whose param writes silently no-op. The rejection is
 * re-thrown so callers can surface an engine-unavailable state.
 */
export async function initCrumbsEngine(instanceId: string, sampleRate: number): Promise<void> {
    ensureCrumbsInstanceFromProject(instanceId);
    ensurePadInstance(instanceId);
    ensureSliceInstance(instanceId);
    try {
        await createCrumbsInstance(instanceId, sampleRate);
    } catch (error) {
        removeInstance(instanceId);
        removePadInstance(instanceId);
        removeSliceInstance(instanceId);
        throw error;
    }
}
