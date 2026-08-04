import { toToasterKitState } from '../models/ToasterKitState';

import { getToasterPresetKit } from './getToasterPresetKit';

type GetToasterPresetDeviceStateOutput = ReturnType<typeof toToasterKitState> | null;

/** Serialize a factory kit through Toaster's device-state owner boundary. */
export function getToasterPresetDeviceState(presetId: string): GetToasterPresetDeviceStateOutput {
    const kit = getToasterPresetKit(presetId);
    if (!kit) {
        return null;
    }

    return toToasterKitState(kit);
}
