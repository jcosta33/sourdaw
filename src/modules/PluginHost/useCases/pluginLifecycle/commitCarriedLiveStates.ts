import { notifyUser } from '#/utils/Notification/notifyUser';

import { carriedExternalPluginStates, currentCarryGeneration } from './carriedExternalPluginStates';

import type { TeardownStateReads } from './readLiveStatesForTeardown';

/**
 * Carry the pre-teardown reads of the instances the teardown actually
 * destroyed. A read for an instance that survived is discarded: an aborted
 * retire or a failed unload must not leave a carry that later overrides newer
 * saved state. A `nothing` read leaves an older carry for that id standing.
 *
 * A batch that started before the carries were dropped belongs to the project
 * that drop retired, so it is discarded whole: no carry, and no warning about
 * edits the outgoing project no longer offers to keep.
 */
export function commitCarriedLiveStates(reads: TeardownStateReads, tornDownInstanceIds: Iterable<string>): void {
    if (reads.generation !== currentCarryGeneration()) {
        return;
    }
    const lostPlugins = new Set<string>();
    for (const instanceId of tornDownInstanceIds) {
        const read = reads.byInstanceId.get(instanceId);
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
        `Unsaved edits in ${[...lostPlugins].join(', ')} could not be read before unloading — the plugin comes back without them.`,
        'warning'
    );
}
