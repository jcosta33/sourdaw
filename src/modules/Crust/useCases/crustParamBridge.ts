/**
 * Crust parameter bridge — throttles UI updates to the audio engine.
 * Same rAF-throttled pattern as glutenParamBridge.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type CrustPatch } from '../models/CrustPatch';
import { loadCrustPatch, setCrustParam } from '../stores/crustStore';

type DeviceRef = { trackId: string; deviceId: string };

function findDeviceRef(deviceId: string): DeviceRef | null {
    for (const track of getAllTracks()) {
        if (track.devices.some((d) => d.id === deviceId)) {
            return { trackId: track.id, deviceId };
        }
    }
    return null;
}

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

const STYLE_INDEX = {
    transparent: 0,
    punchy: 1,
    loud: 2,
} as const;

const ALGORITHM_INDEX = {
    transparent: 0,
    punchy: 1,
    dynamic: 2,
    allround: 3,
    aggressive: 4,
    bus: 5,
    safe: 6,
    wall: 7,
} as const;

const SAT_ALGORITHM_INDEX = {
    soft: 0,
    hard: 1,
    tape: 2,
    tube: 3,
    fold: 4,
} as const;

const MULTIBAND_INDEX = {
    wideband: 0,
    '3band': 1,
    '5band': 2,
} as const;

const STEREO_MODE_INDEX = {
    stereo: 0,
    ms: 1,
} as const;

const DITHER_INDEX = {
    off: 0,
    tpdf16: 1,
    tpdf24: 2,
    powr1: 3,
    powr2: 4,
    powr3: 5,
} as const;

const SCROLL_SPEED_INDEX = {
    slow: 0,
    normal: 1,
    fast: 2,
} as const;

const AB_SLOT_INDEX = {
    a: 0,
    b: 1,
} as const;

function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
    const compositeKey = `${deviceId}:${key}`;
    pendingUpdates.delete(compositeKey);
    const value = latestValues.get(compositeKey);
    if (value === undefined) {
        return;
    }
    latestValues.delete(compositeKey);
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
}

function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
}

function encodeCrustValue(key: string, value: unknown): number | null {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    if (key === 'style') {
        return STYLE_INDEX[value as keyof typeof STYLE_INDEX] ?? 0;
    }

    if (key === 'algorithm') {
        return ALGORITHM_INDEX[value as keyof typeof ALGORITHM_INDEX] ?? 0;
    }

    if (key === 'satAlgorithm') {
        return SAT_ALGORITHM_INDEX[value as keyof typeof SAT_ALGORITHM_INDEX] ?? 0;
    }

    if (key === 'multiBand') {
        return MULTIBAND_INDEX[value as keyof typeof MULTIBAND_INDEX] ?? 0;
    }

    if (key === 'stereoMode') {
        return STEREO_MODE_INDEX[value as keyof typeof STEREO_MODE_INDEX] ?? 0;
    }

    if (key === 'dither') {
        return DITHER_INDEX[value as keyof typeof DITHER_INDEX] ?? 0;
    }

    if (key === 'scrollSpeed') {
        return SCROLL_SPEED_INDEX[value as keyof typeof SCROLL_SPEED_INDEX] ?? 1;
    }

    if (key === 'abSlot') {
        return AB_SLOT_INDEX[value as keyof typeof AB_SLOT_INDEX] ?? 0;
    }

    return null;
}

/**
 * Set a Crust parameter — updates the UI store immediately,
 * throttles audio engine updates to rAF.
 */
export function setCrustParamWithAudio<K extends keyof CrustPatch>(deviceId: string, key: K, value: CrustPatch[K]): void {
    setCrustParam(key, value);

    const encodedValue = encodeCrustValue(key, value);
    if (encodedValue === null) {
        return;
    }

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    latestValues.set(compositeKey, encodedValue);
    if (!pendingUpdates.has(compositeKey)) {
        pendingUpdates.set(
            compositeKey,
            requestAnimationFrame(() => flushParam(deviceId, ref, key))
        );
    }
}

export function loadCrustPatchWithAudio(deviceId: string, patch: CrustPatch): void {
    loadCrustPatch(patch);

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const params: Array<[string, unknown]> = [
        ['gain', patch.gain],
        ['ceiling', patch.ceiling],
        ['style', patch.style],
        ['algorithm', patch.algorithm],
        ['lookahead', patch.lookahead],
        ['attack', patch.attack],
        ['release', patch.release],
        ['attackAuto', patch.attackAuto],
        ['releaseAuto', patch.releaseAuto],
        ['channelLinkTransient', patch.channelLinkTransient],
        ['channelLinkRelease', patch.channelLinkRelease],
        ['truePeak', patch.truePeak],
        ['oversampling', patch.oversampling],
        ['satEnabled', patch.satEnabled],
        ['satAlgorithm', patch.satAlgorithm],
        ['satDrive', patch.satDrive],
        ['satMix', patch.satMix],
        ['deltaListen', patch.deltaListen],
        ['unityGain', patch.unityGain],
        ['multiBand', patch.multiBand],
        ['crossover1', patch.crossover1],
        ['crossover2', patch.crossover2],
        ['scHpfEnabled', patch.scHpfEnabled],
        ['scHpfFreq', patch.scHpfFreq],
        ['stereoMode', patch.stereoMode],
        ['dither', patch.dither],
        ['outputBitDepth', patch.outputBitDepth],
        ['abSlot', patch.abSlot],
        ['scrollSpeed', patch.scrollSpeed],
    ];

    for (const [key, rawValue] of params) {
        const encodedValue = encodeCrustValue(key, rawValue);
        if (encodedValue !== null) {
            pushParamImmediately(ref, key, encodedValue);
        }
    }
}
