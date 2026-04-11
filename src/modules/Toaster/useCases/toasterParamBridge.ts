/**
 * Bridge between Toaster UI and the audio engine.
 * Routes kit-level and pad-level params to the WASM worklet.
 * Uses rAF throttling to avoid flooding MessagePort during knob dragging.
 */

import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getTrackStrip } from '#/modules/AudioEngine/useCases';
import { updateKit, updatePad } from '../stores/toasterStore';
import { type PadState, type ToasterKit } from '../models/ToasterKit';

type DeviceRef = { trackId: string; deviceId: string };

function createFindDeviceRef(getAllTracksFn: typeof getAllTracks) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

const findDeviceRef = createFindDeviceRef(getAllTracks);

export function getFirstToasterDeviceId(): string | null {
    for (const track of getAllTracks()) {
        const device = track.devices.find((d) => d.type === 'toaster');
        if (device) {
            return device.id;
        }
    }
    return null;
}

const padPending = new Map<string, number>();
const padLatest = new Map<string, { pad: number; name: string; value: number }>();

const STRING_FIELDS = new Set(['engineType', 'name', 'color']);

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

function flushPadParam(cacheKey: string, trackId: string): void {
    padPending.delete(cacheKey);
    const entry = padLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    padLatest.delete(cacheKey);

    const strip = getTrackStrip(trackId);
    if (!strip) {
        return;
    }
    const dn = strip.deviceNodes.find((d) => d.toasterControls && d.toasterControls.ready !== undefined);
    if (dn?.toasterControls) {
        dn.toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    if (!STRING_FIELDS.has(key)) {
        updatePad(padIndex, { [key]: value } as Partial<PadState>);
    }

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const cacheKey = `${deviceId}_${padIndex}_${key}`;
    padLatest.set(cacheKey, { pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        padPending.set(cacheKey, requestAnimationFrame(() => flushPadParam(cacheKey, ref.trackId)));
    }
}

export function setToasterKitParam<K extends keyof typeof KIT_PARAM_MAP>(
    deviceId: string,
    key: K,
    value: ToasterKit[K]
): void {
    updateKit({ [key]: value } as Partial<ToasterKit>);

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const paramName = KIT_PARAM_MAP[key];
    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const deviceNode = strip.deviceNodes.find(
        (device) => device.toasterControls && device.toasterControls.ready !== undefined
    );
    if (deviceNode?.toasterControls) {
        deviceNode.toasterControls.setParam(paramName, value as number);
    }
}

/**
 * Send engine_type directly to the worklet (bypasses rAF throttle).
 * Used by sound locks which need immediate engine swap before triggering.
 * Does NOT update the store — the pad's stored engineType remains the default.
 */
export function setPadEngineImmediate(deviceId: string, padIndex: number, engineIdx: number): void {
    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const strip = getTrackStrip(ref.trackId);
    if (!strip) {
        return;
    }
    const dn = strip.deviceNodes.find((d) => d.toasterControls && d.toasterControls.ready !== undefined);
    if (dn?.toasterControls) {
        dn.toasterControls.setPadParam(padIndex, 'engine_type', engineIdx);
    }
}
