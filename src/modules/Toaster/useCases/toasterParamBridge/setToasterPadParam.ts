import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { toPadStoreUpdate } from '../../models/PadStoreUpdate';
import { type PadState } from '../../models/ToasterKit';
import { updatePad } from '../../stores/toasterStore';
import { toasterPadEngineParamName } from '../toasterPadEngineParamName';
import { writeToasterParamsNatively } from '../writeToasterParamsNatively';

import { findReadyToasterControlsOnStrip } from './findReadyToasterControlsOnStrip';
import { padLatest, padPending } from './toasterPadParamQueue';

function flushPadParam(cacheKey: string): void {
    padPending.delete(cacheKey);
    const entry = padLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    padLatest.delete(cacheKey);

    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const strip = getTrackStrip(target.trackId);
    if (!strip) {
        return;
    }
    const toasterControls = findReadyToasterControlsOnStrip({ strip, deviceId: entry.deviceId });
    if (toasterControls) {
        toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
    // The worklet translates the pad field at its own door; the native body has
    // no such door, so the engine's spelling is resolved here.
    writeToasterParamsNatively({
        trackId: target.trackId,
        deviceId: entry.deviceId,
        messages: [
            {
                type: 'padParam',
                pad: entry.pad,
                name: toasterPadEngineParamName(entry.name),
                value: entry.value,
            },
        ],
    });
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const storeUpdate = toPadStoreUpdate({ key, value });
    if (storeUpdate) {
        updatePad(deviceId, padIndex, storeUpdate);
    }

    const cacheKey = `${deviceId}_${padIndex}_${key}`;
    padLatest.set(cacheKey, { deviceId, pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        const rafId = requestAnimationFrame(() => flushPadParam(cacheKey));
        padPending.set(cacheKey, { deviceId, rafId });
    }
}
