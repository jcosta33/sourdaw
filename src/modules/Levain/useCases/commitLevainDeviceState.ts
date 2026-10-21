import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { fromLevainDeviceState, toLevainDeviceState } from '../models/LevainDeviceState';
import { levainStore } from '../stores/levainStore';

/**
 * Mirror a device's selected instrument into project truth.
 *
 * `levainStore` is the session store the panel, the bridge and the worklet share;
 * it is not project truth and is wiped on every project load. This is the one place
 * the instrument identity crosses into the document, and it goes through
 * `executeAppAction` so it rides the same CRDT transaction, persistence and
 * collaboration sync as every other project edit — rather than being captured only
 * at save time, which would lose the choice to any reload the user did not
 * explicitly save first.
 *
 * Fire-and-forget by design: an instrument change is already applied to the store
 * and the sample loader by the time this runs, so a caller that awaited it would
 * stall the panel behind a document write. The action itself is a no-op when the
 * device is gone from project truth.
 */
export function commitLevainDeviceState(deviceId: string): void {
    const patch = levainStore.value?.[deviceId]?.patch;
    if (!patch) {
        return;
    }

    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'levain');
    if (!device || (device.deviceState && device.deviceState.version !== 1)) {
        return;
    }
    const prior = fromLevainDeviceState(device.deviceState);
    if (prior?.instrumentId === patch.instrumentId && prior.currentArticulation === patch.currentArticulation) {
        return;
    }
    // Read the peer's current tier at the write boundary, even if its UI projection has not run yet.
    const tier = device.deviceState?.data.disclosureTier === 'expert' ? 'expert' : 'basic';
    const encoded = toLevainDeviceState(patch, tier);
    const state = { ...encoded, data: { ...device.deviceState?.data, ...encoded.data } };
    void executeAppAction(
        { type: 'setDeviceState', payload: { deviceId, state } },
        { skipMacroRecording: true }
    );
}
