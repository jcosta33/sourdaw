import { executeAppAction } from '#/modules/Command/useCases';

import { toBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';
import { bacteriaStore } from '../stores/bacteriaStore';

/**
 * Mirror a device's live modulation-routing table into project truth.
 *
 * `bacteriaStore` is the session store the panel and the worklet share; it is
 * not project truth and is wiped on every project load. This is the one place
 * the table crosses into the document, and it goes through `executeAppAction`
 * so it rides the same CRDT transaction, persistence and collaboration sync as
 * every other project edit, rather than being captured only at save time,
 * which would lose a routing to any reload the user did not explicitly save
 * first.
 *
 * Fire-and-forget by design: routing edits are UI-rate and already applied to
 * the store and the engine by the time this runs, so a caller that awaited it
 * would stall on a document write. A no-op when the device is gone from
 * project truth.
 */
export function commitBacteriaModAssignments(deviceId: string): void {
    const state = bacteriaStore.value?.[deviceId];
    if (!state) {
        return;
    }

    void executeAppAction(
        {
            type: 'setDeviceState',
            payload: { deviceId, state: toBacteriaModAssignmentsState(state.patch.modAssignments) },
        },
        { skipMacroRecording: true }
    );
}
