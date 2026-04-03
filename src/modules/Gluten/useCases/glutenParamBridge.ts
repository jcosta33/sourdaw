/**
 * Gluten parameter bridge — keeps the patch truthful while throttling
 * audio-engine updates to animation frames.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type GlutenPatch } from '../models/GlutenPatch';
import { loadGlutenPatch, setGlutenParam } from '../stores/glutenStore';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

const TOPOLOGY_INDEX = {
    vca: 0,
    opto: 1,
    fet: 2,
    diode: 3,
} as const;

const STYLE_INDEX = {
    glue: 0,
    punch: 1,
    smooth: 2,
    pump: 3,
} as const;

const DETECTION_INDEX = {
    rms: 0,
    peak: 1,
} as const;

const STEREO_MODE_INDEX = {
    stereo: 0,
    mid: 1,
    side: 2,
    'dual-mono': 3,
} as const;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) {
        return cachedRefs;
    }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'gluten') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;

    if (cacheStaleTimer) {
        clearTimeout(cacheStaleTimer);
    }
    cacheStaleTimer = setTimeout(() => {
        cachedRefs = null;
    }, 2000);

    return refs;
}

function flushParam(key: string): void {
    pendingUpdates.delete(key);
    const value = latestValues.get(key);
    if (value === undefined) {
        return;
    }
    latestValues.delete(key);

    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, key, value);
        persistDeviceParam(deviceId, key, value);
    }
}

function pushParamImmediately(key: string, value: number): void {
    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, key, value);
        persistDeviceParam(deviceId, key, value);
    }
}

function encodeGlutenValue(key: string, value: unknown): number | null {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    if (key === 'topology' || key === 'blendTopology') {
        return TOPOLOGY_INDEX[value as keyof typeof TOPOLOGY_INDEX] ?? 0;
    }

    if (key === 'style') {
        return STYLE_INDEX[value as keyof typeof STYLE_INDEX] ?? 0;
    }

    if (key === 'detection') {
        return DETECTION_INDEX[value as keyof typeof DETECTION_INDEX] ?? 0;
    }

    if (key === 'stereoMode') {
        return STEREO_MODE_INDEX[value as keyof typeof STEREO_MODE_INDEX] ?? 0;
    }

    return null;
}

export function setGlutenParamWithAudio<K extends keyof GlutenPatch>(key: K, value: GlutenPatch[K]): void {
    setGlutenParam(key, value);

    const encodedValue = encodeGlutenValue(key, value);
    if (encodedValue === null) {
        return;
    }

    latestValues.set(key, encodedValue);
    if (!pendingUpdates.has(key)) {
        pendingUpdates.set(
            key,
            requestAnimationFrame(() => flushParam(key))
        );
    }
}

export function loadGlutenPatchWithAudio(patch: GlutenPatch): void {
    loadGlutenPatch(patch);

    const params: Array<[string, unknown]> = [
        ['topology', patch.topology],
        ['style', patch.style],
        ['amount', patch.amount],
        ['threshold', patch.threshold],
        ['ratio', patch.ratio],
        ['attack', patch.attack],
        ['release', patch.release],
        ['knee', patch.knee],
        ['makeup', patch.makeup],
        ['mix', patch.mix],
        ['autoMakeup', patch.autoMakeup],
        ['autoRelease', patch.autoRelease],
        ['range', patch.range],
        ['scHpfFreq', patch.scHpfFreq],
        ['scHpfEnabled', patch.scHpfEnabled],
        ['thrust', patch.thrust],
        ['detection', patch.detection],
        ['stereoMode', patch.stereoMode],
        ['stereoLink', patch.stereoLink],
        ['oversampling', patch.oversampling],
        ['lookahead', patch.lookahead],
        ['scLpfFreq', patch.scLpfFreq],
        ['scLpfEnabled', patch.scLpfEnabled],
        ['scEqFreq', patch.scEqFreq],
        ['scEqGain', patch.scEqGain],
        ['scEqQ', patch.scEqQ],
        ['scEqEnabled', patch.scEqEnabled],
        ['deltaListen', patch.deltaListen],
        ['gainMatchBypass', patch.gainMatchBypass],
        ['extSidechain', patch.extSidechain],
        ['inputGain', patch.inputGain],
        ['outputGain', patch.outputGain],
        ['xfmrDrive', patch.xfmrDrive],
        ['allButtons', patch.allButtons],
        ['limitMode', patch.limitMode],
        ['recovery', patch.recovery],
        ['vcaType', patch.vcaType],
        ['vcaCharacter', patch.vcaCharacter],
        ['feedForward', patch.feedForward],
        ['jfetK3', patch.jfetK3],
        ['xfmrK2', patch.xfmrK2],
        ['blendTopology', patch.blendTopology],
        ['blendAmount', patch.blendAmount],
    ];

    for (const [key, rawValue] of params) {
        const encodedValue = encodeGlutenValue(key, rawValue);
        if (encodedValue !== null) {
            pushParamImmediately(key, encodedValue);
        }
    }
}
