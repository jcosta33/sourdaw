import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ToasterKit } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';
import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';
import { cancelPendingToasterPadParams } from './toasterParamBridge/cancelPendingToasterPadParams';

export function loadToasterKitPreset(deviceId: string, kit: ToasterKit): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // A pad-param edit made just before the load has already written the store
    // but may still be sitting in the rAF coalescing queue. Left alone, that
    // frame fires *after* the projection below and posts the stale pre-preset
    // value to the engine — the panel then shows the preset while the engine
    // plays the old kit's mute/volume/pan. Teardown already cancels the queue
    // (disposeToasterDevice); a preset load replaces the kit just as totally.
    cancelPendingToasterPadParams(deviceId);

    // Update the UI store first
    loadKit(deviceId, kit);

    // Forward to the WASM engine
    const controls = getToasterControls(deviceId);
    if (!controls) {
        return;
    }

    // The same projection the device-load subscriber and the offline render use.
    // This used to be a third hand-maintained copy of it.
    for (const message of projectToasterKitToEngineMessages({ kit })) {
        if (message.type === 'param') {
            controls.setParam(message.name, message.value);
            continue;
        }
        controls.setPadParam(message.pad, message.name, message.value);
    }
}
