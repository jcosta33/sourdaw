import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit } from '../../models/ToasterKit';
import { updateKit } from '../../stores/toasterStore';

import { findDeviceRef } from './helpers';

const KIT_PARAM_MAP = {
    swing: 'swing',
    masterGain: 'master_gain',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    lofiBits: 'lofi_bits',
    lofiRate: 'lofi_rate',
    lofiMix: 'lofi_mix',
} as const;

const kitPending = new Map<string, number>();
const kitLatest = new Map<string, { paramName: string; value: number }>();

function flushKitParam(cacheKey: string, trackId: string): void {
    kitPending.delete(cacheKey);
    const entry = kitLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    kitLatest.delete(cacheKey);

    const strip = getTrackStrip(trackId);
    if (!strip) {
        return;
    }
    const deviceNode = strip.deviceNodes.find(
        (device) => device.toasterControls && device.toasterControls.ready !== undefined
    );
    if (deviceNode?.toasterControls) {
        deviceNode.toasterControls.setParam(entry.paramName, entry.value);
    }
}

export function setToasterKitParam<Key extends keyof typeof KIT_PARAM_MAP>(
    deviceId: string,
    key: Key,
    value: ToasterKit[Key]
): void {
    updateKit(deviceId, { [key]: value });

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const paramName = KIT_PARAM_MAP[key];
    // Coalesce worklet writes per (device, param) to one rAF tick so dragging a
    // kit knob does not flood the worklet at full pointer-event rate. The store
    // already holds the authoritative latest value (updateKit above); only the
    // last value sampled before the frame fires reaches the worklet.
    const cacheKey = `${deviceId}_${key}`;
    kitLatest.set(cacheKey, { paramName, value });
    if (!kitPending.has(cacheKey)) {
        kitPending.set(
            cacheKey,
            requestAnimationFrame(() => flushKitParam(cacheKey, ref.trackId))
        );
    }
}
