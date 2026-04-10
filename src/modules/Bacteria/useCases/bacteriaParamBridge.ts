/**
 * Bacteria parameter bridge — throttles UI updates to audio engine.
 *
 * Same rAF-throttled pattern as glutenParamBridge.
 */
import { inject } from '#/infra/di/inject';
import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement';
import { updateDeviceParam } from '#/modules/AudioEngine';
import { type BacteriaPatch } from '../models/BacteriaPatch';
import { loadBacteriaPatch, setBacteriaParam, setBacteriaBandParam } from '../stores/bacteriaStore';

type DeviceRef = { trackId: string; deviceId: string };

type GetAllTracksFn = typeof getAllTracks;
type UpdateDeviceParamFn = typeof updateDeviceParam;
type PersistDeviceParamFn = typeof persistDeviceParam;

function createFindDeviceRef(getAllTracksFn: GetAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

const DISTORTION_MODE_INDEX = {
    'soft-clip': 0,
    'hard-clip': 1,
    foldback: 2,
    wavefold: 3,
    bitcrush: 4,
    tube: 5,
    breakdown: 6,
    smudge: 7,
    custom: 8,
} as const;

const FILTER_MODE_INDEX = {
    lowpass: 0,
    highpass: 1,
    bandpass: 2,
    notch: 3,
    formant: 4,
    comb: 5,
} as const;

const GRAIN_WINDOW_INDEX = {
    hann: 0,
    gaussian: 1,
} as const;

const CROSSOVER_MODE_INDEX = {
    lr4: 0,
    'linear-phase': 1,
} as const;

const ROUTING_MODE_INDEX = {
    serial: 0,
    parallel: 1,
    'mid-side': 2,
} as const;

function createFlushParam(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
        const compositeKey = `${deviceId}:${key}`;
        pendingUpdates.delete(compositeKey);
        const value = latestValues.get(compositeKey);
        if (value === undefined) return;
        latestValues.delete(compositeKey);
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

function createPushParamImmediately(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

function encodePatchValue(key: string, value: unknown): number | null {
    if (typeof value === 'number') {
        return value;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    if (typeof value !== 'string') {
        return null;
    }

    if (key === 'distortionMode') {
        return DISTORTION_MODE_INDEX[value as keyof typeof DISTORTION_MODE_INDEX] ?? 0;
    }

    if (key === 'filterMode') {
        return FILTER_MODE_INDEX[value as keyof typeof FILTER_MODE_INDEX] ?? 0;
    }

    if (key === 'grainWindow') {
        return GRAIN_WINDOW_INDEX[value as keyof typeof GRAIN_WINDOW_INDEX] ?? 0;
    }

    if (key === 'crossoverMode') {
        return CROSSOVER_MODE_INDEX[value as keyof typeof CROSSOVER_MODE_INDEX] ?? 0;
    }

    if (key === 'globalRouting' || key === 'routingMode') {
        return ROUTING_MODE_INDEX[value as keyof typeof ROUTING_MODE_INDEX] ?? 0;
    }

    return null;
}

export const bacteriaParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
} as const;

export const loadBacteriaPatchWithAudio = inject(bacteriaParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const pushParamImmediately = createPushParamImmediately(updateDeviceParamFn, persistDeviceParamFn);
        return function loadBacteriaPatchWithAudio(deviceId: string, patch: BacteriaPatch): void {
            loadBacteriaPatch(deviceId, patch);

            const ref = findDeviceRef(deviceId);
            if (!ref) return;

            const globalParams: Array<[string, unknown]> = [
        ['mix', patch.mix],
        ['outputGain', patch.outputGain],
        ['inputGain', patch.inputGain],
        ['bypass', patch.bypass],
        ['crossoverMode', patch.crossoverMode],
        ['bandCount', patch.bandCount],
        ['crossoverFreq1', patch.crossoverFreq1],
        ['crossoverFreq2', patch.crossoverFreq2],
        ['crossoverFreq3', patch.crossoverFreq3],
        ['crossoverFreq4', patch.crossoverFreq4],
        ['crossoverFreq5', patch.crossoverFreq5],
        ['crossoverSlope', patch.crossoverSlope],
        ['globalRouting', patch.globalRouting],
        ['macro1', patch.macro1],
        ['macro2', patch.macro2],
        ['macro3', patch.macro3],
        ['macro4', patch.macro4],
        ['macro5', patch.macro5],
        ['macro6', patch.macro6],
        ['macro7', patch.macro7],
        ['macro8', patch.macro8],
        ['morphX', patch.morphX],
        ['morphY', patch.morphY],
        ['lfo1Rate', patch.lfo1Rate],
        ['lfo1Shape', patch.lfo1Shape],
        ['lfo1Amount', patch.lfo1Amount],
        ['lfo2Rate', patch.lfo2Rate],
        ['lfo2Shape', patch.lfo2Shape],
        ['lfo2Amount', patch.lfo2Amount],
        ['envFollowerAttack', patch.envFollowerAttack],
        ['envFollowerRelease', patch.envFollowerRelease],
        ['stepSeqSteps', patch.stepSeqSteps],
        ['stepSeqRate', patch.stepSeqRate],
        ['lorenzSigma', patch.lorenzSigma],
        ['lorenzRho', patch.lorenzRho],
        ['lorenzBeta', patch.lorenzBeta],
        ['lorenzSpeed', patch.lorenzSpeed],
    ];

    for (const [key, rawValue] of globalParams) {
        const encodedValue = encodePatchValue(key, rawValue);
        if (encodedValue !== null) {
            pushParamImmediately(ref, key, encodedValue);
        }
    }

            patch.bands.forEach((band, bandIndex) => {
                const bandParams: Array<[string, unknown]> = [
                    ['enabled', band.enabled],
                    ['solo', band.solo],
                    ['mute', band.mute],
                    ['gain', band.gain],
                    ['oversampling', band.oversampling],
                    ['distortionEnabled', band.distortionEnabled],
                    ['filterEnabled', band.filterEnabled],
                    ['granularEnabled', band.granularEnabled],
                    ['spectralEnabled', band.spectralEnabled],
                    ['modulationEnabled', band.modulationEnabled],
                    ['convolutionEnabled', band.convolutionEnabled],
                    ['freqShiftEnabled', band.freqShiftEnabled],
                    ['chorusEnabled', band.chorusEnabled],
                    ['phaserEnabled', band.phaserEnabled],
                    ['lofiEnabled', band.lofiEnabled],
                    ['distortionMode', band.distortionMode],
                    ['drive', band.drive],
                    ['asymmetry', band.asymmetry],
                    ['foldbackThreshold', band.foldbackThreshold],
                    ['bitDepth', band.bitDepth],
                    ['sampleRateReduce', band.sampleRateReduce],
                    ['tubeBias', band.tubeBias],
                    ['breakdownDepth', band.breakdownDepth],
                    ['filterMode', band.filterMode],
                    ['filterCutoff', band.filterCutoff],
                    ['filterResonance', band.filterResonance],
                    ['filterEnvAmount', band.filterEnvAmount],
                    ['filterEnvAttack', band.filterEnvAttack],
                    ['filterEnvRelease', band.filterEnvRelease],
                    ['chorusRate', band.chorusRate],
                    ['chorusDepth', band.chorusDepth],
                    ['chorusFeedback', band.chorusFeedback],
                    ['chorusMix', band.chorusMix],
                    ['phaserRate', band.phaserRate],
                    ['phaserDepth', band.phaserDepth],
                    ['phaserFeedback', band.phaserFeedback],
                    ['phaserMix', band.phaserMix],
                    ['grainSize', band.grainSize],
                    ['grainDensity', band.grainDensity],
                    ['grainPosOffset', band.grainPosOffset],
                    ['grainPitch', band.grainPitch],
                    ['grainWindow', band.grainWindow],
                    ['grainFreeze', band.grainFreeze],
                    ['grainMix', band.grainMix],
                    ['spectralBlur', band.spectralBlur],
                    ['spectralFreeze', band.spectralFreeze],
                    ['spectralMix', band.spectralMix],
                    ['freqShiftHz', band.freqShiftHz],
                    ['freqShiftMix', band.freqShiftMix],
                    ['lofiAmount', band.lofiAmount],
                    ['codecArtifact', band.codecArtifact],
                    ['convolutionMix', band.convolutionMix],
                    ['convolutionSeparation', band.convolutionSeparation],
                    ['routingMode', band.routingMode],
                ];

                for (const [key, rawValue] of bandParams) {
                    const encodedValue = encodePatchValue(key, rawValue);
                    if (encodedValue !== null) {
                        pushParamImmediately(ref, `band${bandIndex}_${key}`, encodedValue);
                    }
                }
            });
        };
    }
);

/**
 * Set a Bacteria global parameter — updates UI store immediately,
 * throttles audio engine updates to rAF.
 */
export const setBacteriaParamWithAudio = inject(bacteriaParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
        return function setBacteriaParamWithAudio<K extends keyof BacteriaPatch>(
            deviceId: string,
            key: K,
            value: BacteriaPatch[K]
        ): void {
            setBacteriaParam(deviceId, key, value);

            const encodedValue = encodePatchValue(key, value);
            if (encodedValue === null) return;

            const ref = findDeviceRef(deviceId);
            if (!ref) return;

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

/**
 * Set a Bacteria per-band parameter — updates UI store immediately,
 * throttles audio engine updates to rAF with a band-prefixed key.
 */
export const setBacteriaBandParamWithAudio = inject(bacteriaParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
        return function setBacteriaBandParamWithAudio<K extends keyof BacteriaPatch['bands'][0]>(
            deviceId: string,
            bandIndex: number,
            key: K,
            value: BacteriaPatch['bands'][0][K]
        ): void {
            setBacteriaBandParam(deviceId, bandIndex, key, value);

            const prefixedKey = `band${bandIndex}_${key}`;
            const encodedValue = encodePatchValue(String(key), value);
            if (encodedValue === null) return;

            const ref = findDeviceRef(deviceId);
            if (!ref) return;

            const compositeKey = `${deviceId}:${prefixedKey}`;
            latestValues.set(compositeKey, encodedValue);
            if (!pendingUpdates.has(compositeKey)) {
                pendingUpdates.set(
                    compositeKey,
                    requestAnimationFrame(() => flushParam(deviceId, ref, prefixedKey))
                );
            }
        };
    }
);
export type { BacteriaPatch } from '../models/BacteriaPatch';
