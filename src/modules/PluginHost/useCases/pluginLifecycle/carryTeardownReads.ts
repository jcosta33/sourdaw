import { carriedExternalPluginStateFence, carriedExternalPluginStates } from './carriedExternalPluginStates';
import { externalPluginRestoreFailures } from './externalPluginRestoreFailures';
import { loadedExternalInstancePluginIds } from './loadedExternalInstances';

import type { TeardownStateReads } from './readLiveStatesForTeardown';

/**
 * The plugin of a torn-down instance still loaded although the batch holds no
 * current read of it: it was activated after its read started, so the teardown
 * destroyed live state nobody read. A failed restore has no authoritative live
 * state to lose.
 */
function destroyedUnreadPluginId(instanceId: string): string | undefined {
    if (externalPluginRestoreFailures.has(instanceId)) {
        return undefined;
    }
    return loadedExternalInstancePluginIds.get(instanceId);
}

/**
 * Carry the pre-teardown reads of the instances the teardown actually
 * destroyed, and answer the plugins whose live state that teardown lost. A read
 * for an instance that survived is discarded: an aborted retire or a failed
 * unload must not leave a carry that later overrides newer saved state. A
 * `nothing` read leaves an older carry for that id standing.
 *
 * A batch that started before the carries were dropped belongs to the project
 * that drop retired, so it is discarded whole: no carry, and no loss reported
 * for edits the outgoing project no longer offers to keep. A read whose
 * instance's carry slot moved on since it started, or an instance the batch
 * never read, is not carried: a newer teardown, activation or rejected restore
 * already decided that slot. Such an instance is still reported when it is
 * loaded, since the teardown then destroyed live state that was never read.
 */
export function carryTeardownReads(
    reads: TeardownStateReads,
    tornDownInstanceIds: Iterable<string>
): ReadonlySet<string> {
    const lostPlugins = new Set<string>();
    if (reads.generation !== carriedExternalPluginStateFence.generation()) {
        return lostPlugins;
    }
    for (const instanceId of tornDownInstanceIds) {
        const stamped = reads.byInstanceId.get(instanceId);
        if (stamped === undefined || stamped.slotVersion !== carriedExternalPluginStateFence.slotVersion(instanceId)) {
            const unreadPluginId = destroyedUnreadPluginId(instanceId);
            if (unreadPluginId !== undefined) {
                lostPlugins.add(unreadPluginId);
            }
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
    return lostPlugins;
}
