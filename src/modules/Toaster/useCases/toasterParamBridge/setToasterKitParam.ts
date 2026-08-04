import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit } from '../../models/ToasterKit';
import { updateKit } from '../../stores/toasterStore';

import { findToasterNodeOnStrip } from './findToasterNodeOnStrip';

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
const kitLatest = new Map<string, { deviceId: string; paramName: string; value: number }>();

function flushKitParam(cacheKey: string): void {
    kitPending.delete(cacheKey);
    const entry = kitLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    kitLatest.delete(cacheKey);

    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    const strip = getTrackStrip(target.trackId);
    if (!strip) {
        return;
    }
    // Scoped by id — a track can host two Toasters, and this flush used to take
    // whichever came first, so dragging Swing on the second panel retuned the
    // first. No readiness gate on purpose: a Toaster still loading publishes a
    // placeholder whose `setParam` buffers into `pendingParams`, which the
    // loader replays once the worklet is up
    // (AudioEngine/engine/wasmDeviceRegistry.ts). Skipping a not-ready node
    // here would discard every kit edit made during load rather than defer it.
    const deviceNode = findToasterNodeOnStrip({ strip, deviceId: entry.deviceId });
    if (deviceNode?.toasterControls) {
        deviceNode.toasterControls.setParam(entry.paramName, entry.value);
    }
}

export function setToasterKitParam<Key extends keyof typeof KIT_PARAM_MAP>(
    deviceId: string,
    key: Key,
    value: ToasterKit[Key]
): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    updateKit(deviceId, { [key]: value });

    const paramName = KIT_PARAM_MAP[key];
    // Coalesce worklet writes per (device, param) to one rAF tick so dragging a
    // kit knob does not flood the worklet at full pointer-event rate. The store
    // already holds the authoritative latest value (updateKit above); only the
    // last value sampled before the frame fires reaches the worklet.
    const cacheKey = `${deviceId}_${key}`;
    kitLatest.set(cacheKey, { deviceId, paramName, value });
    if (!kitPending.has(cacheKey)) {
        kitPending.set(
            cacheKey,
            requestAnimationFrame(() => flushKitParam(cacheKey))
        );
    }
}
