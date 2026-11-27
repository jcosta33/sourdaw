import { GRINDER_PARAMETER_COUNT, isGrinderRuntimeParameter } from './GrinderRuntimeControl';
import { type RuntimeGrinderNeuralPatch, type RuntimeGrinderNeuralPatchPayload } from './RuntimeGrinderNeuralPatch';

export const APPLY_GRINDER_PRESET_COMMAND = 'apply-grinder-preset';
export const GRINDER_PRESET_RESULT = 'grinder-preset-result';

const DEFAULT_RESTORE_PARAMETERS = new Set([
    'gateAttack',
    'gateRelease',
    'transformerHysteresis',
    'transformerLfSaturation',
    'couplingCapCharge',
]);

export type RuntimeGrinderPresetParameter = Readonly<{ parameterId: string; value: number }>;

export type RuntimeGrinderPreset = Readonly<{
    schemaVersion: 1;
    command: typeof APPLY_GRINDER_PRESET_COMMAND;
    target: RuntimeGrinderNeuralPatch['target'];
    correlation: RuntimeGrinderNeuralPatch['correlation'];
    scheduling: RuntimeGrinderNeuralPatch['scheduling'];
    parameters: readonly RuntimeGrinderPresetParameter[];
    overrides: readonly RuntimeGrinderPresetParameter[];
    resetParameterIds: readonly string[];
    neural: RuntimeGrinderNeuralPatchPayload;
}>;

export type RuntimeGrinderPresetCompilation =
    Readonly<{ status: 'compiled'; patch: RuntimeGrinderPreset }> | Readonly<{ status: 'invalid'; reason: string }>;

export type RuntimeGrinderPresetInput = Pick<RuntimeGrinderPreset, 'parameters' | 'overrides'> & {
    readonly neural: unknown;
    readonly resetParameterIds?: readonly string[];
};

function isPresetParameter(entry: unknown): entry is RuntimeGrinderPresetParameter {
    return (
        typeof entry === 'object' &&
        entry !== null &&
        Reflect.ownKeys(entry).length === 2 &&
        'parameterId' in entry &&
        Object.hasOwn(entry, 'parameterId') &&
        typeof entry.parameterId === 'string' &&
        isGrinderRuntimeParameter(entry.parameterId) &&
        'value' in entry &&
        Object.hasOwn(entry, 'value') &&
        typeof entry.value === 'number' &&
        Number.isFinite(entry.value)
    );
}

function isParameterVector(input: unknown): input is readonly RuntimeGrinderPresetParameter[] {
    if (!Array.isArray(input) || input.length > GRINDER_PARAMETER_COUNT) {
        return false;
    }
    for (const entry of input) {
        if (!isPresetParameter(entry)) {
            return false;
        }
    }
    return true;
}

function hasParameter(
    parameters: readonly RuntimeGrinderPresetParameter[],
    parameterId: string,
    end = parameters.length
): boolean {
    for (let index = 0; index < end; index++) {
        if (parameters[index]?.parameterId === parameterId) {
            return true;
        }
    }
    return false;
}

function hasUniqueParameters(parameters: readonly RuntimeGrinderPresetParameter[]): boolean {
    return parameters.every(({ parameterId }, index) => !hasParameter(parameters, parameterId, index));
}

function isResetVector(
    input: unknown,
    parameters: readonly RuntimeGrinderPresetParameter[]
): input is readonly string[] {
    if (!Array.isArray(input) || input.length > DEFAULT_RESTORE_PARAMETERS.size) {
        return false;
    }
    for (const [index, id] of input.entries()) {
        if (
            typeof id !== 'string' ||
            !DEFAULT_RESTORE_PARAMETERS.has(id) ||
            !hasParameter(parameters, id) ||
            input.indexOf(id) !== index
        ) {
            return false;
        }
    }
    return true;
}

/** Checks bounded vectors before either can contribute a write. */
export function hasRuntimeGrinderPresetScalars(
    input: Record<string, unknown>
): input is Record<string, unknown> & Pick<RuntimeGrinderPreset, 'parameters' | 'overrides' | 'resetParameterIds'> {
    const { parameters, overrides, resetParameterIds } = input;
    return (
        isParameterVector(parameters) &&
        isParameterVector(overrides) &&
        overrides.length <= parameters.length &&
        hasUniqueParameters(parameters) &&
        hasUniqueParameters(overrides) &&
        overrides.every(({ parameterId }) => hasParameter(parameters, parameterId)) &&
        isResetVector(resetParameterIds, parameters)
    );
}
