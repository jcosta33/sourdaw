/**
 * Bacteria parameter bridge — throttles UI updates to audio engine.
 *
 * Same rAF-throttled pattern as glutenParamBridge.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type BacteriaPatch } from '../models/BacteriaPatch';
import { loadBacteriaPatch, setBacteriaParam, setBacteriaBandParam } from '../stores/bacteriaStore';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) {
        return cachedRefs;
    }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'bacteria') {
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

export function loadBacteriaPatchWithAudio(patch: BacteriaPatch): void {
    loadBacteriaPatch(patch);

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
            pushParamImmediately(key, encodedValue);
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
                pushParamImmediately(`band${bandIndex}_${key}`, encodedValue);
            }
        }
    });
}

/**
 * Set a Bacteria global parameter — updates UI store immediately,
 * throttles audio engine updates to rAF.
 */
export function setBacteriaParamWithAudio<K extends keyof BacteriaPatch>(key: K, value: BacteriaPatch[K]): void {
    setBacteriaParam(key, value);

    const encodedValue = encodePatchValue(key, value);
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

/**
 * Set a Bacteria per-band parameter — updates UI store immediately,
 * throttles audio engine updates to rAF with a band-prefixed key.
 */
export function setBacteriaBandParamWithAudio<K extends keyof BacteriaPatch['bands'][0]>(
    bandIndex: number,
    key: K,
    value: BacteriaPatch['bands'][0][K]
): void {
    setBacteriaBandParam(bandIndex, key, value);

    const prefixedKey = `band${bandIndex}_${key}`;
    const encodedValue = encodePatchValue(String(key), value);
    if (encodedValue === null) {
        return;
    }

    latestValues.set(prefixedKey, encodedValue);
    if (!pendingUpdates.has(prefixedKey)) {
        pendingUpdates.set(
            prefixedKey,
            requestAnimationFrame(() => flushParam(prefixedKey))
        );
    }
}
export type { BacteriaPatch } from '../models/BacteriaPatch';
