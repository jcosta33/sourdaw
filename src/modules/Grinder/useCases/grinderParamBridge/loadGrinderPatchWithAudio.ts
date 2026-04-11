import { inject } from '#/infra/di/inject';
import { type GrinderPatch, type GrinderPedal, migrateGrinderPatch } from '../../models/GrinderPatch';
import { loadGrinderPatch } from '../../stores/grinderStore';
import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import type { DeviceRef, PersistDeviceParamFn, UpdateDeviceParamFn } from './helpers';

import {
    AMP_MODELS,
    ENGINE_MODES,
    INPUT_MODES,
    NEURAL_PLACEMENTS,
    NEURAL_TIERS,
    POWER_TUBE_TYPES,
    RECTIFIER_TYPES,
    ROUTING_MODES,
    TONE_STACK_TYPES,
    createFindDeviceRef,
} from './helpers';

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

function getOptionIndex<T extends readonly string[]>(options: T, value: string): number | null {
    const index = options.indexOf(value as T[number]);
    return index >= 0 ? index : null;
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

function createSendNumericParamToDevice(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function sendNumericParamToDevice(ref: DeviceRef, key: string, value: number): void {
        if (!Number.isFinite(value)) return;
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

function findFirstPedal(pedals: readonly GrinderPedal[], types: readonly string[]): GrinderPedal | undefined {
    return pedals.find((pedal) => types.includes(pedal.type));
}

export const loadGrinderPatchWithAudio = inject(grinderParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const sendNumericParamToDevice = createSendNumericParamToDevice(updateDeviceParamFn, persistDeviceParamFn);

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

        return function loadGrinderPatchWithAudio(deviceId: string, patch: GrinderPatch): void {
            const migratedPatch = migrateGrinderPatch(patch);
            loadGrinderPatch(deviceId, migratedPatch);

            const ref = findDeviceRef(deviceId);
            if (!ref) return;

            for (const key of AUDIO_SYNC_KEYS) {
                const value = toAudioValue(key, migratedPatch[key]);
                if (value === null || !Number.isFinite(value)) continue;
                updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
                persistDeviceParamFn(ref.deviceId, key, value);
            }

            syncSupportedPedals(migratedPatch, ref);
        };
    }
);