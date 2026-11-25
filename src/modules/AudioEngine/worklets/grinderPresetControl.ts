import { getGrinderContinuousParameterOrdinal } from '../models/GrinderTimedParameterControl';
import { isRuntimeDeviceControlId as isBoundedId } from '../models/RuntimeDeviceControl';
import {
    hasRuntimeGrinderPresetScalars,
    type RuntimeGrinderPreset,
    type RuntimeGrinderPresetParameter,
} from '../models/RuntimeGrinderPreset';
import { type GrinderInstance } from '../wasm/daw_dsp.js';

import { type GrinderPresetAutomation } from './grinderPresetAutomation';

const MAX_NEURAL_CONV_LAYERS = 10;
type UnknownRecord = Record<string, unknown>;

type GrinderNeuralPatch =
    | { neuralModelMode: 'builtin' }
    | {
          neuralModelMode: 'imported';
          profile: {
              preferredTier?: keyof typeof NEURAL_TIER_INDEX;
              inputDrive?: number | null;
              asymmetry?: number | null;
              outputTrim?: number | null;
              contourMix?: number | null;
              recurrentBias?: number | null;
              convWeights?: readonly (readonly [number, number, number])[];
          };
          /** The imported `.nam` model as JSON (#3774), when the sender proved one. */
          modelJson?: string;
          /** The model's digest, when carried — the re-load gate below reads it. */
          modelDigest?: string;
      };

/** The digest of the model the worklet has already parsed and loaded. */
export type LoadedNeuralModelDigest = { current: string | null };

const NEURAL_TIER_INDEX: Record<string, number> = {
    standard: 0,
    lite: 1,
    nano: 2,
    recurrent: 3,
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return isNonNegativeSafeInteger(value) && value > 0;
}

export function applyNeuralPatch(
    instance: GrinderInstance,
    patch: GrinderNeuralPatch,
    loadedModelDigest: LoadedNeuralModelDigest
): void {
    loadPatchNeuralModel(instance, patch, loadedModelDigest);
    applyNeuralControls(instance, patch, loadedModelDigest);
}

function loadPatchNeuralModel(
    instance: GrinderInstance,
    patch: GrinderNeuralPatch,
    loadedModelDigest: LoadedNeuralModelDigest
): void {
    if (patch.neuralModelMode === 'imported' && patch.modelJson !== undefined) {
        const alreadyLoaded = patch.modelDigest !== undefined && patch.modelDigest === loadedModelDigest.current;
        if (!alreadyLoaded) {
            instance.load_neural_model(patch.modelJson);
            loadedModelDigest.current = patch.modelDigest ?? null;
        }
    }
}

const NEURAL_MODEL_CONTROLS = [
    ['inputDrive', 'neuralCustomInputDrive'],
    ['asymmetry', 'neuralCustomAsymmetry'],
    ['outputTrim', 'neuralCustomOutputTrim'],
    ['contourMix', 'neuralCustomContourMix'],
    ['recurrentBias', 'neuralCustomLstmBias'],
] as const;

function applyNeuralControls(
    instance: GrinderInstance,
    patch: GrinderNeuralPatch,
    loadedModelDigest: LoadedNeuralModelDigest,
    overrides: readonly RuntimeGrinderPresetParameter[] = []
): void {
    if (patch.neuralModelMode === 'builtin') {
        loadedModelDigest.current = null;
        instance.set_param('neuralModelMode', 0);
        return;
    }

    const { profile } = patch;
    const tier = NEURAL_TIER_INDEX[profile.preferredTier ?? 'standard'] ?? 0;
    applyNeuralProfileParameter(instance, 'neuralCustomTier', tier, overrides);
    for (const [field, parameter] of NEURAL_MODEL_CONTROLS) {
        applyNeuralProfileParameter(instance, parameter, profile[field], overrides);
    }
    for (const [layer, [first, second, third]] of (profile.convWeights ?? []).entries()) {
        applyNeuralProfileParameter(instance, `neuralCustomConvWeight${layer}_0`, first, overrides);
        applyNeuralProfileParameter(instance, `neuralCustomConvWeight${layer}_1`, second, overrides);
        applyNeuralProfileParameter(instance, `neuralCustomConvWeight${layer}_2`, third, overrides);
    }
    instance.set_param('neuralModelMode', 1);
}

function applyNeuralProfileParameter(
    instance: GrinderInstance,
    parameter: string,
    base: number | null | undefined,
    overrides: readonly RuntimeGrinderPresetParameter[]
): void {
    const value = findPresetValue(overrides, parameter) ?? base;
    if (value !== null && value !== undefined) {
        instance.set_param(parameter, value);
    }
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isWeightTriple(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.length === 3 &&
        isFiniteNumber(value[0]) &&
        isFiniteNumber(value[1]) &&
        isFiniteNumber(value[2])
    );
}

function isOptionalWeights(value: unknown): boolean {
    if (value === undefined) {
        return true;
    }
    if (!Array.isArray(value) || value.length > MAX_NEURAL_CONV_LAYERS) {
        return false;
    }
    for (const layer of value) {
        if (!isWeightTriple(layer)) {
            return false;
        }
    }
    return true;
}

const NEURAL_PROFILE_FIELDS = ['preferredTier', ...NEURAL_MODEL_CONTROLS.map(([field]) => field), 'convWeights'];

function isGrinderNeuralProfile(profile: UnknownRecord): boolean {
    const { preferredTier, convWeights } = profile;
    return (
        Object.keys(profile).every((key) => NEURAL_PROFILE_FIELDS.includes(key)) &&
        (preferredTier === undefined ||
            (typeof preferredTier === 'string' && Object.hasOwn(NEURAL_TIER_INDEX, preferredTier))) &&
        NEURAL_MODEL_CONTROLS.every(([field]) => {
            const value = profile[field];
            return value === null || value === undefined || isFiniteNumber(value);
        }) &&
        isOptionalWeights(convWeights)
    );
}

export function isGrinderNeuralPatch(value: unknown): value is GrinderNeuralPatch {
    if (!isRecord(value)) {
        return false;
    }
    if (value.neuralModelMode === 'builtin') {
        return Object.keys(value).length === 1;
    }
    const payloadKeys = ['neuralModelMode', 'profile'];
    if (value.modelJson !== undefined) {
        if (typeof value.modelJson !== 'string' || value.modelJson.length === 0) {
            return false;
        }
        payloadKeys.push('modelJson');
    }
    if (value.modelDigest !== undefined) {
        if (!isBoundedId(value.modelDigest)) {
            return false;
        }
        payloadKeys.push('modelDigest');
    }
    return (
        value.neuralModelMode === 'imported' &&
        hasOnlyKeys(value, payloadKeys) &&
        isRecord(value.profile) &&
        isGrinderNeuralProfile(value.profile)
    );
}

export type PresetAddress = Pick<RuntimeGrinderPreset, 'target' | 'correlation'>;

export function isPresetTarget(value: unknown): value is RuntimeGrinderPreset['target'] {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['trackId', 'deviceId', 'deviceType']) &&
        isBoundedId(value.trackId) &&
        isBoundedId(value.deviceId) &&
        value.deviceType === 'grinder'
    );
}

export function isPresetCorrelation(value: unknown): value is RuntimeGrinderPreset['correlation'] {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['workletGeneration', 'controlSequence']) &&
        isPositiveSafeInteger(value.workletGeneration) &&
        isPositiveSafeInteger(value.controlSequence)
    );
}

function isPresetNeuralState(value: unknown): value is RuntimeGrinderPreset['neural'] {
    if (!isGrinderNeuralPatch(value)) {
        return false;
    }
    if (value.neuralModelMode === 'builtin') {
        return true;
    }
    const profile = value.profile;
    return (
        profile.preferredTier !== undefined &&
        profile.convWeights !== undefined &&
        NEURAL_MODEL_CONTROLS.every(([field]) => profile[field] !== undefined) &&
        (value.modelJson !== undefined || value.modelDigest === undefined)
    );
}

export function isPresetData(message: UnknownRecord): message is UnknownRecord & RuntimeGrinderPreset {
    return (
        hasOnlyKeys(message, [
            'schemaVersion',
            'command',
            'target',
            'correlation',
            'scheduling',
            'parameters',
            'overrides',
            'resetParameterIds',
            'neural',
        ]) &&
        isRecord(message.scheduling) &&
        hasOnlyKeys(message.scheduling, ['targetFrame', 'deadlineFrame']) &&
        message.scheduling.targetFrame === null &&
        message.scheduling.deadlineFrame === null &&
        hasRuntimeGrinderPresetScalars(message) &&
        isPresetNeuralState(message.neural)
    );
}

function findPresetValue(
    parameters: readonly RuntimeGrinderPresetParameter[],
    parameterId: string
): number | undefined {
    for (const entry of parameters) {
        if (entry.parameterId === parameterId) {
            return entry.value;
        }
    }
    return undefined;
}

function canRestoreGrinderDefaults(instance: GrinderInstance): instance is GrinderInstance & {
    restore_parameter_default(name: string): boolean;
} {
    return 'restore_parameter_default' in instance && typeof instance.restore_parameter_default === 'function';
}

type PresetApplication = {
    instance: GrinderInstance;
    preset: RuntimeGrinderPreset;
    loadedModelDigest: LoadedNeuralModelDigest;
    automation: GrinderPresetAutomation;
};

export function applyGrinderPreset({
    instance,
    preset,
    loadedModelDigest,
    automation,
}: PresetApplication): string | null {
    if (
        !canRestoreGrinderDefaults(instance) &&
        preset.resetParameterIds.some((id) => findPresetValue(preset.overrides, id) === undefined)
    ) {
        return 'Grinder preset default restore is unavailable';
    }
    try {
        loadPatchNeuralModel(instance, preset.neural, loadedModelDigest);
    } catch (error) {
        // The WASM binding returns a string for a disallowed NAM and a trap for a fault.
        // Parsing precedes installation, so an expected refusal leaves the old model in place.
        if (typeof error === 'string') {
            return error;
        }
        throw error;
    }

    if (
        preset.neural.neuralModelMode === 'imported' &&
        preset.neural.modelJson === undefined &&
        instance.has_loaded_neural_model()
    ) {
        applyNeuralControls(instance, { neuralModelMode: 'builtin' }, loadedModelDigest);
    }
    applyPresetScalars(instance, preset, automation);
    applyNeuralControls(instance, preset.neural, loadedModelDigest, preset.overrides);
    applyBuiltinModelSlot(instance, preset);
    return null;
}

function applyBuiltinModelSlot(instance: GrinderInstance, preset: RuntimeGrinderPreset): void {
    if (preset.neural.neuralModelMode !== 'builtin') {
        return;
    }
    const slot =
        findPresetValue(preset.overrides, 'neuralModelSlot') ?? findPresetValue(preset.parameters, 'neuralModelSlot');
    if (slot !== undefined) {
        instance.set_param('neuralModelSlot', slot);
    }
}

function applyPresetScalars(
    instance: GrinderInstance,
    preset: RuntimeGrinderPreset,
    automation: GrinderPresetAutomation
): void {
    const neuralEnabled =
        findPresetValue(preset.overrides, 'neuralEnabled') ?? findPresetValue(preset.parameters, 'neuralEnabled');
    if (neuralEnabled !== undefined) {
        instance.set_param('neuralEnabled', neuralEnabled);
    }
    for (const parameter of preset.parameters) {
        if (
            parameter.parameterId === 'neuralEnabled' ||
            parameter.parameterId === 'neuralModelMode' ||
            parameter.parameterId === 'neuralModelSlot'
        ) {
            continue;
        }
        applyPresetParameter(instance, parameter, preset, automation);
    }
}

function applyPresetParameter(
    instance: GrinderInstance,
    { parameterId, value }: RuntimeGrinderPresetParameter,
    { overrides, resetParameterIds }: RuntimeGrinderPreset,
    automation: GrinderPresetAutomation
): void {
    const override = findPresetValue(overrides, parameterId);
    if (override === undefined && resetParameterIds.includes(parameterId)) {
        if (!canRestoreGrinderDefaults(instance) || !instance.restore_parameter_default(parameterId)) {
            throw new Error('Grinder preset default restore disagrees with the DSP contract');
        }
        return;
    }
    const effective = override ?? value;
    const ordinal = getGrinderContinuousParameterOrdinal(parameterId);
    if (ordinal !== undefined) {
        automation.adopt(ordinal, effective);
    } else {
        instance.set_param(parameterId, effective);
    }
}
