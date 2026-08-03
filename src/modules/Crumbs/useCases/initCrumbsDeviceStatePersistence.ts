import { crumbsStore, type CrumbsState } from '../stores/crumbsStore';

import { commitCrumbsDeviceState } from './commitCrumbsDeviceState';

/** The two fields the chunk carries, flattened to one comparable key. */
function playbackKey(state: CrumbsState): string {
    return `${state.mode} ${state.activeSample?.filePath ?? ''} ${state.activeSample?.sampleId ?? ''}`;
}

/**
 * Mirror every Crumbs sample load and mode switch into project truth.
 *
 * Subscribing to the session store rather than calling `commitCrumbsDeviceState`
 * from each mutation site follows `initToasterKitPersistence`: the store is written
 * by the sample loader, the file-drop handler, the mode switch and the recorder, and
 * a persistence call added to each of them is a list that goes stale the moment
 * someone adds the next one.
 *
 * Change is detected on the **two fields the chunk carries**, not on state identity.
 * `setMetering` rewrites peak levels and voice counts on every animation frame, and
 * committing on those would open a document transaction per frame for the lifetime
 * of the session.
 *
 * A device is recorded on first sight without committing. `ensureCrumbsInstanceFromProject`
 * seeds the entry from either the module default or the chunk just read back out of
 * the document; neither is an edit, and committing them would write a chunk for
 * every Crumbs ever loaded and mark a freshly opened project dirty.
 */
export function initCrumbsDeviceStatePersistence(): () => void {
    const committed = new Map<string, string>();

    return crumbsStore.subscribe((instances) => {
        if (!instances) {
            committed.clear();
            return;
        }

        for (const [deviceId, state] of Object.entries(instances)) {
            const previous = committed.get(deviceId);
            const current = playbackKey(state);
            committed.set(deviceId, current);

            if (previous === undefined || previous === current) {
                continue;
            }
            commitCrumbsDeviceState(deviceId);
        }

        // Drop devices that are gone, so a device id reused by a later load is
        // treated as first sight again rather than compared against a stale sample.
        for (const deviceId of committed.keys()) {
            if (!(deviceId in instances)) {
                committed.delete(deviceId);
            }
        }
    });
}
