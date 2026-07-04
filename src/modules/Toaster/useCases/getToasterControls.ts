import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { findDeviceRef } from './toasterParamBridge/helpers';

type GetToasterControlsOutput = {
    setPadParam: (pad: number, name: string, value: number) => void;
    setParam: (name: string, value: number) => void;
} | null;

export function getToasterControls(deviceId: string): GetToasterControlsOutput {
    // Scope the lookup to THIS device. Picking the first toaster track (the
    // old behavior) routed instance B's controls onto instance A's worklet.
    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return null;
    }

    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return null;
    }

    const dn = strip.deviceNodes.find((data) => data.deviceId === deviceId && data.toasterControls?.ready);
    return dn?.toasterControls ?? null;
}
