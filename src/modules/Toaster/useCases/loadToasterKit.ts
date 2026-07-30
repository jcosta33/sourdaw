import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ToasterKit } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';
import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';

export function loadToasterKitPreset(deviceId: string, kit: ToasterKit): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

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

    // Engine-specific voicing, which the projection deliberately excludes because
    // the other two callers have never sent it. Loading a preset is the one moment
    // where applying it is unambiguously right: the values arrive together with the
    // engine they belong to, so there is no stale-key hazard. Kept here as an
    // addition to the shared projection rather than a reason to fork it.
    for (const [index, pad] of kit.pads.entries()) {
        for (const [key, value] of Object.entries(pad.engineParams)) {
            controls.setPadParam(index, key, value);
        }
    }
}
