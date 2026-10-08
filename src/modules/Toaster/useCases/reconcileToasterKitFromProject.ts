import { trackStore } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { fromToasterKitState } from '../models/ToasterKitState';
import { toasterStore } from '../stores/toasterStore';

import { loadToasterKitPreset } from './loadToasterKit';

/**
 * Apply authoritative project kit state to a loaded Toaster session (#4764).
 *
 * The inbound half of `initToasterKitPersistence`: the peer's kit commit landed
 * in the document without any local trigger firing, so this reads the chunk the
 * same way `hydrateToasterKitFromProject` does at load and pushes it through
 * the same wholesale-replacement route a preset pick uses — store, worklet and
 * native session in one gesture. A device with no session record is skipped:
 * nothing live holds a stale kit, and its load path rehydrates from the
 * document anyway.
 *
 * The comparison is the GB hydrate's diff gate: the decoded kit is compared
 * with the session kit and equal chunks cost nothing. That gate is also the
 * loop stop — the persistence subscriber mirrors a reconciled kit back into the
 * document (an identical chunk), that write re-fires the sweep, and the
 * comparison reads equal and leaves everything untouched.
 */
export function reconcileToasterKitFromProject(deviceId: string): void {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return;
    }

    const device = tracks.flatMap((track) => track.devices).find((candidate) => candidate.id === deviceId);
    if (!device || !device.deviceState) {
        // No chunk is no inbound change. An undo that removes the last kit
        // commit ever recorded leaves the loaded kit stale — the same window a
        // session that never saved has — and is not worth a default-kit stomp
        // over every unrelated document write.
        return;
    }

    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const kit = fromToasterKitState(device.deviceState);
    if (jsonValuesEqual(state.kit, kit)) {
        return;
    }

    loadToasterKitPreset(deviceId, kit);
}
