/**
 * Gluten parameter bridge — keeps the patch truthful while throttling
 * audio-engine updates to animation frames.
 */
import { inject } from '#/infra/di/inject';
import { updateDeviceParam } from '#/modules/AudioEngine';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement';
import { type GlutenPatch } from '../models/GlutenPatch';
import { loadGlutenPatch, setGlutenParam } from '../stores/glutenStore';

type DeviceRef = { trackId: string; deviceId: string };

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

type BridgeDeps = {
    updateDeviceParam: typeof updateDeviceParam;
    persistDeviceParam: typeof persistDeviceParam;
};

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

function createFlushHandlers(deps: BridgeDeps) {
    function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
        const compositeKey = `${deviceId}:${key}`;
        pendingUpdates.delete(compositeKey);
        const value = latestValues.get(compositeKey);
        if (value === undefined) {
            return;
        }
        latestValues.delete(compositeKey);
        deps.updateDeviceParam(ref.trackId, ref.deviceId, key, value);
        deps.persistDeviceParam(ref.deviceId, key, value);
    }

    function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        deps.updateDeviceParam(ref.trackId, ref.deviceId, key, value);
        deps.persistDeviceParam(ref.deviceId, key, value);
    }

    return { flushParam, pushParamImmediately };
}

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

export const setGlutenParamWithAudio = inject({ updateDeviceParam, persistDeviceParam, getAllTracks })(
    (deps) => {
        const { flushParam } = createFlushHandlers(deps);
        const findDeviceRef = createFindDeviceRef(deps.getAllTracks);

        return function setGlutenParamWithAudio<K extends keyof GlutenPatch>(
            deviceId: string,
            key: K,
            value: GlutenPatch[K]
        ): void {
            setGlutenParam(deviceId, key, value);

            const encodedValue = encodeGlutenValue(key, value);
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
        };
    }
);

export const loadGlutenPatchWithAudio = inject({ updateDeviceParam, persistDeviceParam, getAllTracks })(
    (deps) => {
        const { pushParamImmediately } = createFlushHandlers(deps);
        const findDeviceRef = createFindDeviceRef(deps.getAllTracks);

        return function loadGlutenPatchWithAudio(deviceId: string, patch: GlutenPatch): void {
            loadGlutenPatch(deviceId, patch);

            const ref = findDeviceRef(deviceId);
            if (!ref) {
                return;
            }

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
                    pushParamImmediately(ref, key, encodedValue);
                }
            }
        };
    }
);
