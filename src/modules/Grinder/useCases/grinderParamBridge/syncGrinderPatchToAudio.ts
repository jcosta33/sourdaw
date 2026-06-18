import { type GrinderPatch, type GrinderPedal, migrateGrinderPatch } from '../../models/GrinderPatch';

import {
    AMP_MODELS,
    CAB_TYPES,
    ENGINE_MODES,
    type GrinderNeuralAudioPatch,
    INPUT_MODES,
    NEURAL_PLACEMENTS,
    NEURAL_TIERS,
    POWER_TUBE_TYPES,
    RECTIFIER_TYPES,
    ROUTING_MODES,
    TONE_STACK_TYPES,
    type DeviceRef,
    getCabIrSlot,
    getPedalOrderAudioEntries,
    getNeuralModelSlot,
} from './helpers';

type SyncGrinderPatchToAudioInput = {
    patch: GrinderPatch;
    ref: DeviceRef;
    persist_device_param: (device_id: string, key: string, value: number) => void;
    update_device_param: (track_id: string, device_id: string, key: string, value: number) => void;
    update_device_patch: (track_id: string, device_id: string, patch: Record<string, unknown>) => void;
};

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
    'cabType',
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
    'micBlend',
    'roomAmount',
] as const;

function getOptionIndex<TOptions extends readonly string[]>(options: TOptions, value: string): number | null {
    const index = options.indexOf(value as TOptions[number]);
    return index >= 0 ? index : null;
}

function toAudioValue<TKey extends keyof GrinderPatch>(key: TKey, value: GrinderPatch[TKey]): number | null {
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
        case 'cabType':
            return getOptionIndex(CAB_TYPES, value as string);
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

function sendNumericParamToDevice(
    input: Pick<SyncGrinderPatchToAudioInput, 'persist_device_param' | 'ref' | 'update_device_param'>,
    key: string,
    value: number
): void {
    if (!Number.isFinite(value)) {
        return;
    }

    input.update_device_param(input.ref.trackId, input.ref.deviceId, key, value);
    input.persist_device_param(input.ref.deviceId, key, value);
}

function findFirstPedal(pedals: readonly GrinderPedal[], types: readonly string[]): GrinderPedal | undefined {
    return pedals.find((pedal) => types.includes(pedal.type));
}

function sendPatchToDevice(
    input: Pick<SyncGrinderPatchToAudioInput, 'ref' | 'update_device_patch'>,
    patch: GrinderNeuralAudioPatch
): void {
    input.update_device_patch(input.ref.trackId, input.ref.deviceId, patch);
}

export function syncGrinderPatchToAudio(input: SyncGrinderPatchToAudioInput): void {
    const patch = migrateGrinderPatch(input.patch);
    const cab_ir_slot = getCabIrSlot(patch.cabIrId);

    if (cab_ir_slot !== null) {
        sendNumericParamToDevice(input, 'cabIrSlot', cab_ir_slot);
    }

    for (const key of AUDIO_SYNC_KEYS) {
        const value = toAudioValue(key, patch[key]);
        if (value === null || !Number.isFinite(value)) {
            continue;
        }

        sendNumericParamToDevice(input, key, value);
    }

    const preCompressor = findFirstPedal(patch.prePedals, ['compressor']);
    const preOverdrive = findFirstPedal(patch.prePedals, ['overdrive', 'boost']);
    const preDistortion = findFirstPedal(patch.prePedals, ['distortion']);
    const preFuzz = findFirstPedal(patch.prePedals, ['fuzz']);
    sendNumericParamToDevice(input, 'preCompressorEnabled', preCompressor?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'preCompressorThreshold', preCompressor?.params.threshold ?? -20);
    sendNumericParamToDevice(input, 'preCompressorRatio', preCompressor?.params.ratio ?? 4);
    sendNumericParamToDevice(input, 'preCompressorAttack', preCompressor?.params.attack ?? 10);
    sendNumericParamToDevice(input, 'preCompressorRelease', preCompressor?.params.release ?? 200);
    sendNumericParamToDevice(input, 'preOverdriveEnabled', preOverdrive?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'preOverdriveDrive', preOverdrive?.params.drive ?? 0);
    sendNumericParamToDevice(input, 'preOverdriveTone', preOverdrive?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'preOverdriveLevel', preOverdrive?.params.level ?? 5);
    sendNumericParamToDevice(input, 'preDistortionEnabled', preDistortion?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'preDistortionDrive', preDistortion?.params.drive ?? 0);
    sendNumericParamToDevice(input, 'preDistortionTone', preDistortion?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'preDistortionLevel', preDistortion?.params.level ?? 5);
    sendNumericParamToDevice(input, 'preFuzzEnabled', preFuzz?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'preFuzzFuzz', preFuzz?.params.fuzz ?? 0);
    sendNumericParamToDevice(input, 'preFuzzTone', preFuzz?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'preFuzzLevel', preFuzz?.params.level ?? 5);

    const postCompressor = findFirstPedal(patch.postPedals, ['compressor']);
    const postOverdrive = findFirstPedal(patch.postPedals, ['overdrive', 'boost']);
    const postDistortion = findFirstPedal(patch.postPedals, ['distortion']);
    const postFuzz = findFirstPedal(patch.postPedals, ['fuzz']);
    sendNumericParamToDevice(input, 'postCompressorEnabled', postCompressor?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'postCompressorThreshold', postCompressor?.params.threshold ?? -20);
    sendNumericParamToDevice(input, 'postCompressorRatio', postCompressor?.params.ratio ?? 4);
    sendNumericParamToDevice(input, 'postCompressorAttack', postCompressor?.params.attack ?? 10);
    sendNumericParamToDevice(input, 'postCompressorRelease', postCompressor?.params.release ?? 200);
    sendNumericParamToDevice(input, 'postOverdriveEnabled', postOverdrive?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'postOverdriveDrive', postOverdrive?.params.drive ?? 0);
    sendNumericParamToDevice(input, 'postOverdriveTone', postOverdrive?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'postOverdriveLevel', postOverdrive?.params.level ?? 5);
    sendNumericParamToDevice(input, 'postDistortionEnabled', postDistortion?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'postDistortionDrive', postDistortion?.params.drive ?? 0);
    sendNumericParamToDevice(input, 'postDistortionTone', postDistortion?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'postDistortionLevel', postDistortion?.params.level ?? 5);
    sendNumericParamToDevice(input, 'postFuzzEnabled', postFuzz?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'postFuzzFuzz', postFuzz?.params.fuzz ?? 0);
    sendNumericParamToDevice(input, 'postFuzzTone', postFuzz?.params.tone ?? 5);
    sendNumericParamToDevice(input, 'postFuzzLevel', postFuzz?.params.level ?? 5);

    for (const entry of getPedalOrderAudioEntries(false, patch.prePedals)) {
        sendNumericParamToDevice(input, entry.key, entry.value);
    }

    for (const entry of getPedalOrderAudioEntries(true, patch.postPedals)) {
        sendNumericParamToDevice(input, entry.key, entry.value);
    }

    if (patch.neuralModelSource === 'imported' && patch.neuralModelProfile) {
        sendPatchToDevice(input, {
            neuralModelMode: 'imported',
            profile: patch.neuralModelProfile,
        });
    } else {
        sendPatchToDevice(input, { neuralModelMode: 'builtin' });
        const neural_model_slot = getNeuralModelSlot(patch.neuralModelId);
        if (neural_model_slot !== null) {
            sendNumericParamToDevice(input, 'neuralModelSlot', neural_model_slot);
        }
    }

    sendNumericParamToDevice(input, 'mic1Enabled', patch.mic1.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'mic1PositionX', patch.mic1.positionX);
    sendNumericParamToDevice(input, 'mic1PositionY', patch.mic1.positionY);
    sendNumericParamToDevice(input, 'mic1Distance', patch.mic1.distance);
    sendNumericParamToDevice(input, 'mic1Gain', patch.mic1.gain);
    sendNumericParamToDevice(input, 'mic2Enabled', patch.mic2.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'mic2PositionX', patch.mic2.positionX);
    sendNumericParamToDevice(input, 'mic2PositionY', patch.mic2.positionY);
    sendNumericParamToDevice(input, 'mic2Distance', patch.mic2.distance);
    sendNumericParamToDevice(input, 'mic2Gain', patch.mic2.gain);
}
