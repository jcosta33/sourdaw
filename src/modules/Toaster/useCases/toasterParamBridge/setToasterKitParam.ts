import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type ToasterKit } from '../../models/ToasterKit';
import { updateKit } from '../../stores/toasterStore';
import { writeToasterParamsNatively } from '../writeToasterParamsNatively';

import { findToasterNodeOnStrip } from './findToasterNodeOnStrip';
import { kitPending } from './toasterKitParamQueue';

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

function flushKitParam(cacheKey: string): void {
    const entry = kitPending.get(cacheKey);
    if (!entry) {
        return;
    }
    kitPending.delete(cacheKey);

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
    // `paramName` is already the engine's own spelling, which is the vocabulary
    // the native body takes.
    writeToasterParamsNatively({
        trackId: target.trackId,
        deviceId: entry.deviceId,
        messages: [{ type: 'param', name: entry.paramName, value: entry.value }],
    });
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
    const frame = kitPending.get(cacheKey)?.frame ?? requestAnimationFrame(() => flushKitParam(cacheKey));
    kitPending.set(cacheKey, { frame, deviceId, paramName, value });
}
