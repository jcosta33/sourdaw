import { notifyUser } from '#/utils/Notification/notifyUser';

import { carriedExternalPluginStateFence, carriedExternalPluginStates } from './carriedExternalPluginStates';

import type { TeardownStateReads } from './readLiveStatesForTeardown';

/**
 * Carry the pre-teardown reads of the instances the teardown actually
 * destroyed. A read for an instance that survived is discarded: an aborted
 * retire or a failed unload must not leave a carry that later overrides newer
 * saved state. A `nothing` read leaves an older carry for that id standing.
 *
 * A batch that started before the carries were dropped belongs to the project
 * that drop retired, so it is discarded whole: no carry, and no warning about
 * edits the outgoing project no longer offers to keep. A read whose instance's
 * carry slot moved on since it started is skipped, neither carried nor
 * warned about: a newer teardown, activation or rejected restore already
 * decided that slot.
 */
export function commitCarriedLiveStates(reads: TeardownStateReads, tornDownInstanceIds: Iterable<string>): void {
    if (reads.generation !== carriedExternalPluginStateFence.generation()) {
        return;
    }
    const lostPlugins = new Set<string>();
    for (const instanceId of tornDownInstanceIds) {
        const stamped = reads.byInstanceId.get(instanceId);
        if (stamped === undefined || stamped.slotVersion !== carriedExternalPluginStateFence.slotVersion(instanceId)) {
            continue;
        }
        const { read } = stamped;
        if (read.status === 'carried') {
            carriedExternalPluginStates.set(instanceId, { pluginId: read.pluginId, stateChunk: read.stateChunk });
            carriedExternalPluginStateFence.advanceSlot(instanceId);
        } else if (read.status === 'lost') {
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
