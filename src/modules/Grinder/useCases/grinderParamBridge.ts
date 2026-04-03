/**
 * Grinder parameter bridge — throttles UI updates to audio engine.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type GrinderPatch, type GrinderPedal, migrateGrinderPatch } from '../models/GrinderPatch';
import { loadGrinderPatch, setGrinderParam } from '../stores/grinderStore';

type DeviceRef = { trackId: string; deviceId: string };

function findDeviceRef(deviceId: string): DeviceRef | null {
    for (const track of getAllTracks()) {
        if (track.devices.some((d) => d.id === deviceId)) {
            return { trackId: track.id, deviceId };
        }
    }
    return null;
}

const AMP_MODELS = ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'] as const;
const ENGINE_MODES = ['circuit', 'capture', 'hybrid'] as const;
const INPUT_MODES = ['instrument', 'line', 'reamp'] as const;
const TONE_STACK_TYPES = ['fender', 'marshall', 'vox'] as const;
const POWER_TUBE_TYPES = ['6l6', 'el34', 'el84'] as const;
const RECTIFIER_TYPES = ['tube', 'solid-state', 'variac'] as const;
const NEURAL_PLACEMENTS = ['amp-capture', 'rig-capture'] as const;
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
    'engineMode',
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
    'neuralPlacement',
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

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
    const compositeKey = `${deviceId}:${key}`;
    pendingUpdates.delete(compositeKey);
    const value = latestValues.get(compositeKey);
    if (value === undefined) return;
    latestValues.delete(compositeKey);
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
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
        case 'engineMode':
            return getIndexedValue(ENGINE_MODES, value) as GrinderPatch[K];
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
        case 'neuralPlacement':
            return getIndexedValue(NEURAL_PLACEMENTS, value) as GrinderPatch[K];
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
        case 'engineMode':
            return getOptionIndex(ENGINE_MODES, value as string);
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
        case 'neuralPlacement':
            return getOptionIndex(NEURAL_PLACEMENTS, value as string);
        case 'neuralTier':
            return getOptionIndex(NEURAL_TIERS, value as string);
        case 'routingMode':
            return getOptionIndex(ROUTING_MODES, value as string);
        default:
            return null;
    }
}

function sendNumericParamToDevice(ref: DeviceRef, key: string, value: number): void {
    if (!Number.isFinite(value)) return;
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
}

function findFirstPedal(pedals: readonly GrinderPedal[], types: readonly string[]): GrinderPedal | undefined {
    return pedals.find((pedal) => types.includes(pedal.type));
}

function syncSupportedPedals(patch: GrinderPatch, ref: DeviceRef): void {
    const preCompressor = findFirstPedal(patch.prePedals, ['compressor']);
    const preOverdrive = findFirstPedal(patch.prePedals, ['overdrive', 'boost']);
    const preDistortion = findFirstPedal(patch.prePedals, ['distortion']);
    const preFuzz = findFirstPedal(patch.prePedals, ['fuzz']);
    sendNumericParamToDevice(ref, 'preCompressorEnabled', preCompressor?.enabled ? 1 : 0);
    sendNumericParamToDevice(ref, 'preCompressorThreshold', preCompressor?.params.threshold ?? -20);
    sendNumericParamToDevice(ref, 'preCompressorRatio', preCompressor?.params.ratio ?? 4);
    sendNumericParamToDevice(ref, 'preCompressorAttack', preCompressor?.params.attack ?? 10);
    sendNumericParamToDevice(ref, 'preCompressorRelease', preCompressor?.params.release ?? 200);

    sendNumericParamToDevice(ref, 'preOverdriveEnabled', preOverdrive?.enabled ? 1 : 0);
    sendNumericParamToDevice(ref, 'preOverdriveDrive', preOverdrive?.params.drive ?? 0);
    sendNumericParamToDevice(ref, 'preOverdriveTone', preOverdrive?.params.tone ?? 5);
    sendNumericParamToDevice(ref, 'preOverdriveLevel', preOverdrive?.params.level ?? 5);

    sendNumericParamToDevice(ref, 'preDistortionEnabled', preDistortion?.enabled ? 1 : 0);
    sendNumericParamToDevice(ref, 'preDistortionDrive', preDistortion?.params.drive ?? 0);
    sendNumericParamToDevice(ref, 'preDistortionTone', preDistortion?.params.tone ?? 5);
    sendNumericParamToDevice(ref, 'preDistortionLevel', preDistortion?.params.level ?? 5);

    sendNumericParamToDevice(ref, 'preFuzzEnabled', preFuzz?.enabled ? 1 : 0);
    sendNumericParamToDevice(ref, 'preFuzzFuzz', preFuzz?.params.fuzz ?? 0);
    sendNumericParamToDevice(ref, 'preFuzzTone', preFuzz?.params.tone ?? 5);
    sendNumericParamToDevice(ref, 'preFuzzLevel', preFuzz?.params.level ?? 5);
}

export function setGrinderParamWithAudio<K extends keyof GrinderPatch>(deviceId: string, key: K, value: number): void {
    const patchValue = toPatchValue(key, value);
    setGrinderParam(deviceId, key, patchValue);
    if (key === 'engineMode') {
        setGrinderParam(deviceId, 'neuralEnabled', (patchValue !== 'circuit') as GrinderPatch['neuralEnabled']);
    } else if (key === 'neuralEnabled') {
        setGrinderParam(
            deviceId,
            'engineMode',
            (patchValue ? 'hybrid' : 'circuit') as GrinderPatch['engineMode']
        );
    }

    const ref = findDeviceRef(deviceId);
    if (!ref) return;

    const compositeKey = `${deviceId}:${key}`;
    latestValues.set(compositeKey, value);
    if (!pendingUpdates.has(compositeKey)) {
        pendingUpdates.set(
            compositeKey,
            requestAnimationFrame(() => flushParam(deviceId, ref, key))
        );
    }
}

export function loadGrinderPatchWithAudio(deviceId: string, patch: GrinderPatch): void {
    const migratedPatch = migrateGrinderPatch(patch);
    loadGrinderPatch(deviceId, migratedPatch);

    const ref = findDeviceRef(deviceId);
    if (!ref) return;

    for (const key of AUDIO_SYNC_KEYS) {
        const value = toAudioValue(key, migratedPatch[key]);
        if (value === null || !Number.isFinite(value)) continue;
        updateDeviceParam(ref.trackId, ref.deviceId, key, value);
        persistDeviceParam(ref.deviceId, key, value);
    }

    syncSupportedPedals(migratedPatch, ref);
}
