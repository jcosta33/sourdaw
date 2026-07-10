import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type PadState } from '../models/ToasterKit';
import { updatePad } from '../stores/toasterStore';

import { findDeviceRef } from './toasterParamBridge/helpers';

/**
 * Send a pad param straight to the worklet, bypassing the rAF coalescing in
 * setToasterPadParam. 16-Levels triggers the pad synchronously right after
 * setting the param, so a deferred (rAF) flush would make the first hit play
 * with the previous value and collapse multiple cells within one frame to the
 * latest value (Finding #48). The store is still updated so the UI stays in
 * sync, matching setToasterPadParam's store-then-worklet effect.
 */
type SetPadParamImmediateInput = {
    deviceId: string;
    padIndex: number;
    key: keyof PadState;
    value: number;
};

export function setPadParamImmediate(input: SetPadParamImmediateInput): void {
    const { deviceId, padIndex, key, value } = input;

    updatePad(deviceId, padIndex, { [key]: value } as Partial<PadState>);

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }
    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const toasterControls = strip.deviceNodes.find(
        (data) => data.toasterControls?.ready !== undefined
    )?.toasterControls;
    toasterControls?.setPadParam(padIndex, key, value);
}
