import { type RuntimeGrinderNeuralPatchCompilation } from '../models/RuntimeGrinderNeuralPatch';

const MAX_ID_LENGTH = 128;
const MAX_CONV_LAYERS = 10;
const NEURAL_TIERS = ['standard', 'lite', 'nano', 'recurrent'] as const;

type UnknownRecord = Record<string, unknown>;

function invalid(reason: string): RuntimeGrinderNeuralPatchCompilation {
    return { status: 'invalid', reason };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function toFiniteOrNull(value: unknown): number | null | undefined {
    if (value === undefined) {
        return null;
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function compileImportedPayload(value: unknown): RuntimeGrinderNeuralPatchCompilation {
    if (
        !isRecord(value) ||
        !hasOnlyKeys(value, ['neuralModelMode', 'profile']) ||
        value.neuralModelMode !== 'imported'
    ) {
        return invalid('Runtime Grinder neural patch payload has an unsupported schema');
    }
    if (!isRecord(value.profile)) {
        return invalid('Runtime Grinder imported neural profile is invalid');
    }
    const profile = value.profile;
    if (
        !hasOnlyKeys(profile, [
            'derivedFrom',
            'sourceArchitecture',
            'sourceSampleRate',
            'sourceWeightCount',
            'preferredTier',
            'inputDrive',
            'asymmetry',
            'outputTrim',
            'contourMix',
            'recurrentBias',
            'convWeights',
        ])
    ) {
        return invalid('Runtime Grinder imported neural profile has an unsupported schema');
    }
    const rawPreferredTier = profile.preferredTier;
    if (
        rawPreferredTier !== undefined &&
        (typeof rawPreferredTier !== 'string' ||
            !NEURAL_TIERS.includes(rawPreferredTier as (typeof NEURAL_TIERS)[number]))
    ) {
        return invalid('Runtime Grinder neural tier is invalid');
    }
    const preferredTier = (rawPreferredTier ?? 'standard') as (typeof NEURAL_TIERS)[number];
    const inputDrive = toFiniteOrNull(profile.inputDrive);
    const asymmetry = toFiniteOrNull(profile.asymmetry);
    const outputTrim = toFiniteOrNull(profile.outputTrim);
    const contourMix = toFiniteOrNull(profile.contourMix);
    const recurrentBias = toFiniteOrNull(profile.recurrentBias);
    if (
        inputDrive === undefined ||
        asymmetry === undefined ||
        outputTrim === undefined ||
        contourMix === undefined ||
        recurrentBias === undefined
    ) {
        return invalid('Runtime Grinder neural profile contains a non-finite scalar');
    }
    const rawWeights = profile.convWeights ?? [];
    if (!Array.isArray(rawWeights) || rawWeights.length > MAX_CONV_LAYERS) {
        return invalid('Runtime Grinder convolution weights are invalid');
    }
    const convWeights: Array<readonly [number, number, number]> = [];
    for (const layer of rawWeights) {
        if (
            !Array.isArray(layer) ||
            layer.length !== 3 ||
            typeof layer[0] !== 'number' ||
            !Number.isFinite(layer[0]) ||
            typeof layer[1] !== 'number' ||
            !Number.isFinite(layer[1]) ||
            typeof layer[2] !== 'number' ||
            !Number.isFinite(layer[2])
        ) {
            return invalid('Runtime Grinder convolution weight layer is invalid');
        }
        convWeights.push(Object.freeze([layer[0], layer[1], layer[2]]));
    }
    return {
        status: 'compiled',
        patch: Object.freeze({
            schemaVersion: 1,
            command: 'apply-grinder-neural-patch',
            target: Object.freeze({ trackId: '', deviceId: '', deviceType: 'grinder' }),
            patch: Object.freeze({
                neuralModelMode: 'imported',
                profile: Object.freeze({
                    preferredTier,
                    inputDrive,
                    asymmetry,
                    outputTrim,
                    contourMix,
                    recurrentBias,
                    convWeights: Object.freeze(convWeights),
                }),
            }),
            correlation: Object.freeze({ workletGeneration: 0, controlSequence: 0 }),
            scheduling: Object.freeze({ targetFrame: null, deadlineFrame: null }),
        }),
    };
}

/** Validates, normalizes, and freezes one immediate Grinder neural patch. */
export function compileRuntimeGrinderNeuralPatch(input: unknown): RuntimeGrinderNeuralPatchCompilation {
    if (
        !isRecord(input) ||
        !hasOnlyKeys(input, ['schemaVersion', 'command', 'target', 'patch', 'correlation', 'scheduling']) ||
        input.schemaVersion !== 1 ||
        input.command !== 'apply-grinder-neural-patch' ||
        !isRecord(input.target) ||
        !hasOnlyKeys(input.target, ['trackId', 'deviceId', 'deviceType']) ||
        !isBoundedId(input.target.trackId) ||
        !isBoundedId(input.target.deviceId) ||
        input.target.deviceType !== 'grinder' ||
        !isRecord(input.correlation) ||
        !hasOnlyKeys(input.correlation, ['workletGeneration', 'controlSequence']) ||
        !isPositiveSafeInteger(input.correlation.workletGeneration) ||
        !isPositiveSafeInteger(input.correlation.controlSequence) ||
        !isRecord(input.scheduling) ||
        !hasOnlyKeys(input.scheduling, ['targetFrame', 'deadlineFrame']) ||
        input.scheduling.targetFrame !== null ||
        input.scheduling.deadlineFrame !== null
    ) {
        return invalid('Runtime Grinder neural patch has an unsupported schema');
    }
    let payload: RuntimeGrinderNeuralPatchCompilation;
    if (
        isRecord(input.patch) &&
        input.patch.neuralModelMode === 'builtin' &&
        hasOnlyKeys(input.patch, ['neuralModelMode', 'profile'])
    ) {
        payload = {
            status: 'compiled',
            patch: Object.freeze({
                schemaVersion: 1,
                command: 'apply-grinder-neural-patch',
                target: Object.freeze({ trackId: '', deviceId: '', deviceType: 'grinder' }),
                patch: Object.freeze({ neuralModelMode: 'builtin' }),
                correlation: Object.freeze({ workletGeneration: 0, controlSequence: 0 }),
                scheduling: Object.freeze({ targetFrame: null, deadlineFrame: null }),
            }),
        };
    } else {
        payload = compileImportedPayload(input.patch);
    }
    if (payload.status === 'invalid') {
        return payload;
    }
    return {
        status: 'compiled',
        patch: Object.freeze({
            schemaVersion: 1,
            command: 'apply-grinder-neural-patch',
            target: Object.freeze({
                trackId: input.target.trackId,
                deviceId: input.target.deviceId,
                deviceType: 'grinder',
            }),
            patch: payload.patch.patch,
            correlation: Object.freeze({
                workletGeneration: input.correlation.workletGeneration,
                controlSequence: input.correlation.controlSequence,
            }),
            scheduling: Object.freeze({ targetFrame: null, deadlineFrame: null }),
        }),
    };
}
