import { toasterStore } from '../stores/toasterStore';

import { commitToasterKit } from './commitToasterKit';

/**
 * Mirror every Toaster kit edit into project truth.
 *
 * Subscribing to the session store rather than calling `commitToasterKit` from each
 * mutation site is deliberate. The kit is reached from a dozen places — the panel
 * drives several store mutators directly, the param bridge writes pad and kit fields,
 * presets replace the kit wholesale, Euclidean fills rewrite steps — and a persistence
 * call added to each of them is a list that silently goes stale the moment someone
 * adds the thirteenth. One subscription cannot miss a path, including paths that do
 * not exist yet.
 *
 * Change is detected by **kit object identity**, which is what makes this affordable:
 * the store also carries transport state, and `runSequencerTick` rewrites
 * `currentStep` on every step of every bar while keeping the same `kit` reference. A
 * value comparison would commit on each of those; a reference comparison ignores all
 * of them and fires only when a mutator actually produced a new kit.
 *
 * A device is recorded on first sight without committing. Registration is a device's
 * first appearance, and the kit it appears with is either the default or the one just
 * read back from the document — neither is an edit, and committing them would write a
 * chunk for every Toaster ever loaded and mark a freshly opened project dirty.
 */
export function initToasterKitPersistence(): () => void {
    const committedKits = new Map<string, unknown>();

    return toasterStore.subscribe((instances) => {
        if (!instances) {
            committedKits.clear();
            return;
        }

        for (const [deviceId, state] of Object.entries(instances)) {
            const previous = committedKits.get(deviceId);
            committedKits.set(deviceId, state.kit);

            if (previous === undefined || previous === state.kit) {
                continue;
            }
            commitToasterKit(deviceId);
        }

        // Drop devices that are gone, so a device id reused by a later load is
        // treated as first sight again rather than compared against a stale kit.
        for (const deviceId of committedKits.keys()) {
            if (!(deviceId in instances)) {
                committedKits.delete(deviceId);
            }
        }
    });
}
