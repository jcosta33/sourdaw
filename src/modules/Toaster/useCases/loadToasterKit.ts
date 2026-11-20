import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ToasterKit } from '../models/ToasterKit';
import { loadKit } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';
import { projectToasterKitToEngineMessages } from './projectToasterKitToEngineMessages';
import { cancelPendingToasterKitParams } from './toasterParamBridge/cancelPendingToasterKitParams';
import { cancelPendingToasterPadParams } from './toasterParamBridge/cancelPendingToasterPadParams';
import { writeToasterParamsNatively } from './writeToasterParamsNatively';

export function loadToasterKitPreset(deviceId: string, kit: ToasterKit): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // A queued frame holds values from the replaced kit and would overwrite the engine below.
    cancelPendingToasterPadParams(deviceId);
    cancelPendingToasterKitParams(deviceId);

    loadKit(deviceId, kit);

    const controls = getToasterControls(deviceId);
    // The same projection the device-load subscriber and the offline render use.
    const messages = projectToasterKitToEngineMessages({ kit });
    if (controls) {
        for (const message of messages) {
            if (message.type === 'param') {
                controls.setParam(message.name, message.value);
                continue;
            }
            controls.setPadParam(message.pad, message.name, message.value);
        }
    }

    // A preset replaces the whole kit, so the native session needs the whole
    // record — one batch, because `sendNativeDeviceParameters` refuses to split
    // one gesture across two and a Toaster holding half of each preset is
    // audibly neither.
    writeToasterParamsNatively({ trackId: target.trackId, deviceId, messages });
}
