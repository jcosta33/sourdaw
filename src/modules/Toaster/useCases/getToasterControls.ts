import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { findReadyToasterControlsOnStrip } from './toasterParamBridge/findReadyToasterControlsOnStrip';
import { findDeviceRef } from './toasterParamBridge/helpers';

type GetToasterControlsOutput = ReturnType<typeof findReadyToasterControlsOnStrip>;

export function getToasterControls(deviceId: string): GetToasterControlsOutput {
    // Owner lookup differs from the param-bridge callers on purpose: this path
    // takes the first track owning the device with no eligibility gate, where
    // `resolveEligibleDeviceWriteTarget` also demands a globally unique device
    // and a track kind that accepts device updates. That difference is upstream
    // of the strip; the strip-level selection is shared so the predicate cannot
    // drift apart across the three call sites again.
    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return null;
    }

    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return null;
    }

    return findReadyToasterControlsOnStrip({ strip, deviceId });
}
