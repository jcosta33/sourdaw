import { crumbsStore, type CrumbsState } from '../stores/crumbsStore';
import { hasUnsettledCrumbsPairedReconcile } from '../stores/sampleLoadGate';

import { commitCrumbsDeviceState } from './commitCrumbsDeviceState';
import { liveCrumbsMirrorPass } from './crumbsDeviceStateMirror';

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
 * Metering state (peak levels, voice counts) rides the same store but stays outside
 * the key, so a per-frame metering feed could rewrite it freely — committing on
 * those would open a document transaction per frame for the lifetime of the session.
 *
 * A device is recorded on first sight without committing. `ensureCrumbsInstanceFromProject`
 * seeds the entry from either the module default or the chunk just read back out of
 * the document; neither is an edit, and committing them would write a chunk for
 * every Crumbs ever loaded and mark a freshly opened project dirty.
 */
export function initCrumbsDeviceStatePersistence(): () => void {
    const committed = new Map<string, string>();

    const mirrorPass = (deviceId: string, state: CrumbsState): void => {
        const previous = committed.get(deviceId);
        const current = playbackKey(state);
        if (previous !== undefined && previous !== current && hasUnsettledCrumbsPairedReconcile(deviceId)) {
            // #4764: this edit is a reconcile-initiated mode apply whose
            // paired sample load is still unsettled, so the activeSample
            // beside the new mode is still the stale local one. Committing
            // it would mirror the stale sample over the peer's document
            // reference. Leave the baseline at the last committed key: the
            // pair's release replays this pass against the settled store
            // and commits then.
            return;
        }
        committed.set(deviceId, current);

        if (previous === undefined || previous === current) {
            return;
        }
        commitCrumbsDeviceState(deviceId);
    };
    liveCrumbsMirrorPass.current = mirrorPass;

    const unsubscribe = crumbsStore.subscribe((instances) => {
        if (!instances) {
            committed.clear();
            return;
        }

        for (const [deviceId, state] of Object.entries(instances)) {
            mirrorPass(deviceId, state);
        }

        // Drop devices that are gone, so a device id reused by a later load is
        // treated as first sight again rather than compared against a stale sample.
        for (const deviceId of committed.keys()) {
            if (!(deviceId in instances)) {
                committed.delete(deviceId);
            }
        }
    });

    return () => {
        if (liveCrumbsMirrorPass.current === mirrorPass) {
            liveCrumbsMirrorPass.current = null;
        }
        unsubscribe();
    };
}
