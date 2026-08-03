import { executeAppAction } from '#/modules/Command/useCases';

import { toCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { crumbsStore } from '../stores/crumbsStore';

/**
 * Mirror a device's sample and operating mode into project truth.
 *
 * `crumbsStore` is the session store the panel and the worklet share; it is not
 * project truth and is wiped on every project load. This is the one place a
 * Crumbs sample reference crosses into the document, and it goes through
 * `executeAppAction` so it rides the same CRDT transaction, persistence and
 * collaboration sync as every other project edit — rather than being captured only
 * at save time, which would lose the sample to any reload the user did not
 * explicitly save first.
 *
 * Fire-and-forget by design: the sample is already loaded and the store already
 * updated by the time this runs. The action itself is a no-op when the device is
 * gone from project truth.
 */
export function commitCrumbsDeviceState(deviceId: string): void {
    const state = crumbsStore.value?.[deviceId];
    if (!state) {
        return;
    }

    void executeAppAction(
        {
            type: 'setDeviceState',
            payload: {
                deviceId,
                state: toCrumbsDeviceState({ mode: state.mode, activeSample: state.activeSample }),
            },
        },
        { skipMacroRecording: true }
    );
}
