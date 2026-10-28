import { executeAppAction } from '#/modules/Command/useCases';

import { toToasterKitState } from '../models/ToasterKitState';
import { toasterStore } from '../stores/toasterStore';

/**
 * Mirror a device's live kit into project truth.
 *
 * `toasterStore` is the session store the panel and the worklet share; it is not
 * project truth and is wiped on every project load. This is the one place the kit
 * crosses into the document, and it goes through `executeAppAction` so it rides the
 * same CRDT transaction, persistence and collaboration sync as every other project
 * edit — rather than being captured only at save time, which would lose a kit to any
 * reload the user did not explicitly save first.
 *
 * Fire-and-forget by design: kit edits are UI-rate and already applied to the store
 * and the engine by the time this runs, so a caller that awaited it would stall a
 * knob sweep on a document write. The action itself is a no-op when the device is
 * gone from project truth.
 */
export function commitToasterKit(deviceId: string): void {
    const kit = toasterStore.value?.[deviceId]?.kit;
    if (!kit) {
        return;
    }

    void executeAppAction(
        { type: 'setDeviceState', payload: { deviceId, state: toToasterKitState(kit) } },
        { skipMacroRecording: true }
    );
}
