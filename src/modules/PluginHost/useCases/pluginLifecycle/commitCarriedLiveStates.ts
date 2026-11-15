import { notifyUser } from '#/utils/Notification/notifyUser';

import { carriedExternalPluginStates } from './carriedExternalPluginStates';

import type { readLiveStatesForTeardown } from './readLiveStatesForTeardown';

/**
 * Carry the pre-teardown reads of the instances the teardown actually
 * destroyed. A read for an instance that survived is discarded: an aborted
 * retire or a failed unload must not leave a carry that later overrides newer
 * saved state. A `nothing` read leaves an older carry for that id standing.
 */
export function commitCarriedLiveStates(
    reads: Awaited<ReturnType<typeof readLiveStatesForTeardown>>,
    tornDownInstanceIds: Iterable<string>
): void {
    const lostPlugins = new Set<string>();
    for (const instanceId of tornDownInstanceIds) {
        const read = reads.get(instanceId);
        if (read?.status === 'carried') {
            carriedExternalPluginStates.set(instanceId, { pluginId: read.pluginId, stateChunk: read.stateChunk });
        } else if (read?.status === 'lost') {
            lostPlugins.add(read.pluginId);
        }
    }
    if (lostPlugins.size === 0) {
        return;
    }
    notifyUser(
        `Unsaved edits in ${[...lostPlugins].join(', ')} could not be read before unloading — the last saved state will be restored.`,
        'warning'
    );
}
