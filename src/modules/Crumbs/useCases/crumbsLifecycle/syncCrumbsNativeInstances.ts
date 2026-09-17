/**
 * One native Crumbs instance per Crumbs device on the project, for as long as
 * the device is on it (#4204).
 *
 * The panel used to own that lifetime: it created the runtime on mount and
 * destroyed it on unmount. That made the sampler audible only while its window
 * was open — the mapper splices a Crumbs device onto its strip by the instance
 * the engine holds, so a closed panel left the device with no native body, and
 * the strip fell back to Web Audio mid-session. A device on a track is a device
 * that has to sound whether or not anyone is looking at it, so the project is
 * what the instance follows.
 *
 * Modelled on `syncKneadToEngine`: one subscription to `trackStore`, and the
 * whole of the device population re-read from it on every notification rather
 * than a list each mutation site is expected to maintain.
 *
 * ## The restore must not dirty the project
 *
 * A device coming back from a saved project carries its sample path in project
 * truth, and the native instance starts empty — so the appearance has to load
 * it back. What it must *not* do is write that load's result into
 * `crumbsStore`: `initCrumbsDeviceStatePersistence` commits a document chunk
 * whenever a device's `playbackKey` (mode, file path, sample id) changes, and
 * the id a fresh instance assigns is its own counter's, not the saved one. So
 * the restore reads `CrumbsLoadResult` for its decode warnings and writes
 * nothing: `load_sample` already selects the sample it just decoded inside the
 * instance, which is the whole of what the engine needs, and every field the
 * panel displays was hydrated from the document by
 * `ensureCrumbsInstanceFromProject` a moment earlier.
 *
 * ## Serialised per device
 *
 * A create is a round trip, and a device can be removed — by an undo, by a
 * track delete — before it comes back. Unserialised, the removal's destroy
 * would reach the native side first and the create would leave an instance
 * behind for a device that no longer exists. Each device id therefore has its
 * own chain, and work queued for it runs in the order the project changed.
 */

import { logger } from '#/infra/logger/appLogger';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';

import { createCrumbsInstance } from '../../repositories/crumbsBridge/createCrumbsInstance';
import { destroyCrumbsInstance } from '../../repositories/crumbsBridge/destroyCrumbsInstance';
import { isCrumbsNativeAvailable } from '../../repositories/crumbsBridge/isCrumbsNativeAvailable';
import { loadSample } from '../../repositories/crumbsBridge/loadSample';
import { markCrumbsInstanceAttached, markCrumbsInstanceDetached } from '../../stores/crumbsEngineAttachmentStore';
import {
    forgetCrumbsInstanceLifecycle,
    markCrumbsInstanceBound,
    markCrumbsInstanceCreating,
    markCrumbsInstanceFailed,
} from '../../stores/crumbsNativeLifecycleStore';
import { crumbsStore, removeInstance } from '../../stores/crumbsStore';
import { ensurePadInstance, removePadInstance } from '../../stores/padStore';
import { ensureSliceInstance, removeSliceInstance } from '../../stores/sliceStore';

import { ensureCrumbsInstanceFromProject } from './ensureCrumbsInstanceFromProject';

/** The project's device type for the Crumbs sampler (`CrumbsDescriptor`). */
const CRUMBS_DEVICE_TYPE = 'builtin-crumbs';

/**
 * The refusal `create_crumbs` answers for an id it already holds. Not an error
 * for this sync: something else — the panel of an older session, a create this
 * chain already ran — bound the id, and the instance the device needs exists.
 */
function isDuplicateInstanceRefusal(error: unknown): boolean {
    return error instanceof Error && error.message.includes('already exists');
}

function crumbsDeviceIds(state: TrackStoreState | null): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const track of state?.tracks ?? []) {
        for (const device of track.devices) {
            if (device.type === CRUMBS_DEVICE_TYPE) {
                ids.add(device.id);
            }
        }
    }
    return ids;
}

async function openInstance(deviceId: string): Promise<void> {
    // Recorded before the round trip so a panel opening while it is in flight
    // reads an undecided device rather than a failed one.
    markCrumbsInstanceCreating(deviceId);
    // Seeded from project truth before the round trip, so the sample path the
    // restore below reads is the document's and not a module default.
    ensureCrumbsInstanceFromProject(deviceId);
    ensurePadInstance(deviceId);
    ensureSliceInstance(deviceId);

    try {
        const { attached } = await createCrumbsInstance(deviceId);
        markCrumbsInstanceBound(deviceId);
        if (attached) {
            markCrumbsInstanceAttached(deviceId);
        }
    } catch (error) {
        if (isDuplicateInstanceRefusal(error)) {
            // The id is bound, so the device has a sampler; which creator made
            // it does not change what a write reaches.
            logger.debug(`[Crumbs] instance ${deviceId} is already bound to the engine`);
            markCrumbsInstanceBound(deviceId);
            return;
        }
        // Rolled back for the same reason the panel's own init used to roll it
        // back: a populated entry with no instance behind it is a device whose
        // every parameter write silently no-ops. The panel cannot read that
        // from the absence of the entry — its own mount seeds one straight back
        // through `ensureCrumbsInstanceFromProject` — so the failure is
        // recorded here instead.
        logger.warn(`[Crumbs] could not create the native instance for ${deviceId}: ${String(error)}`);
        markCrumbsInstanceFailed(deviceId);
        removeInstance(deviceId);
        removePadInstance(deviceId);
        removeSliceInstance(deviceId);
        return;
    }

    const filePath = crumbsStore.value?.[deviceId]?.activeSample?.filePath;
    if (!filePath) {
        return;
    }
    try {
        const restored = await loadSample(deviceId, filePath);
        if (restored.decodeWarningCount > 0) {
            logger.warn(
                `[Crumbs] restored "${filePath}" for ${deviceId} after skipping ` +
                    `${String(restored.decodeWarningCount)} corrupt audio packet(s):`,
                restored.decodeWarnings
            );
        }
    } catch (error) {
        // A sample the musician moved or deleted since the save is a device
        // that plays silence, exactly as it did before this restore existed.
        logger.warn(`[Crumbs] could not restore "${filePath}" for ${deviceId}: ${String(error)}`);
    }
}

async function closeInstance(deviceId: string): Promise<void> {
    // The retraction leads the destroy, for the reason PluginHost states for a
    // hosted unload: between the native side dropping the instance and this
    // process hearing about it, a play that still read the mirror would build a
    // strip naming an instance the engine no longer holds, and the mapper
    // refuses that batch whole.
    markCrumbsInstanceDetached(deviceId);
    forgetCrumbsInstanceLifecycle(deviceId);
    removeInstance(deviceId);
    removePadInstance(deviceId);
    removeSliceInstance(deviceId);
    try {
        await destroyCrumbsInstance(deviceId);
    } catch (error) {
        logger.warn(`[Crumbs] could not destroy the native instance for ${deviceId}: ${String(error)}`);
    }
}

export function syncCrumbsNativeInstances(): () => void {
    if (!isCrumbsNativeAvailable()) {
        // No native side to own an instance on. The Web Audio Crumbs node is
        // built with the strip and needs nothing from here.
        return () => undefined;
    }

    const live = new Set<string>();
    const chains = new Map<string, Promise<void>>();

    const queue = (deviceId: string, work: () => Promise<void>): void => {
        const chain = (chains.get(deviceId) ?? Promise.resolve()).then(work, work);
        chains.set(deviceId, chain);
        void chain.then(() => {
            if (chains.get(deviceId) === chain) {
                chains.delete(deviceId);
            }
        });
    };

    return trackStore.subscribe((state) => {
        const present = crumbsDeviceIds(state);

        for (const deviceId of present) {
            if (live.has(deviceId)) {
                continue;
            }
            live.add(deviceId);
            queue(deviceId, () => openInstance(deviceId));
        }

        for (const deviceId of [...live]) {
            if (present.has(deviceId)) {
                continue;
            }
            live.delete(deviceId);
            queue(deviceId, () => closeInstance(deviceId));
        }
    });
}
