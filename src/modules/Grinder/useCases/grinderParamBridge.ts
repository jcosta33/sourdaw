/**
 * Grinder parameter bridge — throttles UI updates to audio engine.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type GrinderPatch, type GrinderPedal } from '../models/GrinderPatch';
import { loadGrinderPatch, setGrinderParam } from '../stores/grinderStore';

type DeviceRef = { trackId: string; deviceId: string };

const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;
const ROUTING_MODES = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;

const BOOLEAN_PATCH_KEYS: ReadonlySet<keyof GrinderPatch> = new Set([
    'gateEnabled',
    'bright',
    'fat',
    'brightCap',
    'cabEnabled',
    'cabOpenBack',
    'neuralEnabled',
    'limiterEnabled',
]);

const AUDIO_SYNC_KEYS: readonly (keyof GrinderPatch)[] = [
    'inputImpedance',
    'inputGain',
    'gateEnabled',
    'gateThreshold',
    'gateAttack',
    'gateRelease',
    'ampModel',
    'gain',
    'channel',
    'bright',
    'fat',
    'tubeBias',
    'tubeAge',
    'millerCapacitance',
    'gridConduction',
    'couplingCapCharge',
    'toneStackType',
    'bass',
    'mid',
    'treble',
    'presence',
    'resonance',
    'brightCap',
    'master',
    'powerTubeType',
    'rectifierType',
    'sagAmount',
    'sagRecovery',
    'negFeedback',
    'powerAmpBias',
    'transformerDrive',
    'transformerHysteresis',
    'transformerLfSaturation',
    'cabEnabled',
    'cabResonanceFreq',
    'cabResonanceQ',
    'cabDamping',
    'cabOpenBack',
    'coneBreakup',
    'backEmf',
    'neuralEnabled',
    'neuralTier',
    'neuralMix',
    'neuralCpuBudget',
    'outputGain',
    'outputMix',
    'limiterEnabled',
    'limiterThreshold',
    'cleanBlend',
    'routingMode',
] as const;

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) {
        return cachedRefs;
    }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'grinder') {
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

function getIndexedValue<T extends readonly string[]>(options: T, raw: number): T[number] {
    const rounded = Math.round(raw);
    const safeIndex = Number.isFinite(rounded)
        ? Math.max(0, Math.min(options.length - 1, rounded))
        : 0;
    return (options[safeIndex] ?? options[0]) as T[number];
}

function getOptionIndex<T extends readonly string[]>(options: T, value: string): number | null {
    const index = options.indexOf(value as T[number]);
    return index >= 0 ? index : null;
}

function toPatchValue<K extends keyof GrinderPatch>(key: K, value: number): GrinderPatch[K] {
    if (BOOLEAN_PATCH_KEYS.has(key)) {
        return (value > 0.5) as GrinderPatch[K];
    }

    switch (key) {
        case 'ampModel':
            return getIndexedValue(AMP_MODELS, value) as GrinderPatch[K];
        case 'inputMode':
            return getIndexedValue(INPUT_MODES, value) as GrinderPatch[K];
        case 'toneStackType':
            return getIndexedValue(TONE_STACK_TYPES, value) as GrinderPatch[K];
        case 'powerTubeType':
            return getIndexedValue(POWER_TUBE_TYPES, value) as GrinderPatch[K];
        case 'rectifierType':
            return getIndexedValue(RECTIFIER_TYPES, value) as GrinderPatch[K];
        case 'neuralTier':
            return getIndexedValue(NEURAL_TIERS, value) as GrinderPatch[K];
        case 'routingMode':
            return getIndexedValue(ROUTING_MODES, value) as GrinderPatch[K];
        default:
            return value as GrinderPatch[K];
    }
}

function toAudioValue<K extends keyof GrinderPatch>(key: K, value: GrinderPatch[K]): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    switch (key) {
        case 'ampModel':
            return getOptionIndex(AMP_MODELS, value as string);
        case 'inputMode':
            return getOptionIndex(INPUT_MODES, value as string);
        case 'toneStackType':
            return getOptionIndex(TONE_STACK_TYPES, value as string);
        case 'powerTubeType':
            return getOptionIndex(POWER_TUBE_TYPES, value as string);
        case 'rectifierType':
            return getOptionIndex(RECTIFIER_TYPES, value as string);
        case 'neuralTier':
            return getOptionIndex(NEURAL_TIERS, value as string);
        case 'routingMode':
            return getOptionIndex(ROUTING_MODES, value as string);
        default:
            return null;
    }
}

function sendNumericParamToDevices(key: string, value: number, devices: DeviceRef[]): void {
    if (!Number.isFinite(value)) {
        return;
    }

    for (const { trackId, deviceId } of devices) {
        updateDeviceParam(trackId, deviceId, key, value);
        persistDeviceParam(deviceId, key, value);
    }
}

function findFirstPedal(pedals: readonly GrinderPedal[], types: readonly string[]): GrinderPedal | undefined {
    return pedals.find((pedal) => types.includes(pedal.type));
}

function syncSupportedPedals(patch: GrinderPatch, devices: DeviceRef[]): void {
    const preCompressor = findFirstPedal(patch.prePedals, ['compressor']);
    const preOverdrive = findFirstPedal(patch.prePedals, ['overdrive', 'boost']);
    const preDistortion = findFirstPedal(patch.prePedals, ['distortion']);
    const preFuzz = findFirstPedal(patch.prePedals, ['fuzz']);
    sendNumericParamToDevices('preCompressorEnabled', preCompressor?.enabled ? 1 : 0, devices);
    sendNumericParamToDevices('preCompressorThreshold', preCompressor?.params.threshold ?? -20, devices);
    sendNumericParamToDevices('preCompressorRatio', preCompressor?.params.ratio ?? 4, devices);
    sendNumericParamToDevices('preCompressorAttack', preCompressor?.params.attack ?? 10, devices);
    sendNumericParamToDevices('preCompressorRelease', preCompressor?.params.release ?? 200, devices);

    sendNumericParamToDevices('preOverdriveEnabled', preOverdrive?.enabled ? 1 : 0, devices);
    sendNumericParamToDevices('preOverdriveDrive', preOverdrive?.params.drive ?? 0, devices);
    sendNumericParamToDevices('preOverdriveTone', preOverdrive?.params.tone ?? 5, devices);
    sendNumericParamToDevices('preOverdriveLevel', preOverdrive?.params.level ?? 5, devices);

    sendNumericParamToDevices('preDistortionEnabled', preDistortion?.enabled ? 1 : 0, devices);
    sendNumericParamToDevices('preDistortionDrive', preDistortion?.params.drive ?? 0, devices);
    sendNumericParamToDevices('preDistortionTone', preDistortion?.params.tone ?? 5, devices);
    sendNumericParamToDevices('preDistortionLevel', preDistortion?.params.level ?? 5, devices);

    sendNumericParamToDevices('preFuzzEnabled', preFuzz?.enabled ? 1 : 0, devices);
    sendNumericParamToDevices('preFuzzFuzz', preFuzz?.params.fuzz ?? 0, devices);
    sendNumericParamToDevices('preFuzzTone', preFuzz?.params.tone ?? 5, devices);
    sendNumericParamToDevices('preFuzzLevel', preFuzz?.params.level ?? 5, devices);
}

export function setGrinderParamWithAudio<K extends keyof GrinderPatch>(key: K, value: number): void {
    setGrinderParam(key, toPatchValue(key, value));

    latestValues.set(key, value);
    if (!pendingUpdates.has(key)) {
        pendingUpdates.set(
            key,
            requestAnimationFrame(() => flushParam(key))
        );
    }
}

export function loadGrinderPatchWithAudio(patch: GrinderPatch): void {
    loadGrinderPatch(patch);

    const devices = getActiveDevices();
    for (const key of AUDIO_SYNC_KEYS) {
        const value = toAudioValue(key, patch[key]);
        if (value === null || !Number.isFinite(value)) {
            continue;
        }

        for (const { trackId, deviceId } of devices) {
            updateDeviceParam(trackId, deviceId, key, value);
            persistDeviceParam(deviceId, key, value);
        }
    }

    syncSupportedPedals(patch, devices);
}
