import {
    APPLY_GRINDER_PRESET_COMMAND,
    hasRuntimeGrinderPresetScalars,
    type RuntimeGrinderPresetCompilation,
    type RuntimeGrinderPresetParameter,
} from '../models/RuntimeGrinderPreset';

import { compileRuntimeGrinderNeuralPatch } from './compileRuntimeGrinderNeuralPatch';

const PRESET_FIELDS = [
    'schemaVersion',
    'command',
    'target',
    'correlation',
    'scheduling',
    'parameters',
    'overrides',
    'resetParameterIds',
    'neural',
] as const;

function hasExactFields(input: unknown, fields: readonly string[]): input is Record<string, unknown> {
    return (
        typeof input === 'object' &&
        input !== null &&
        !Array.isArray(input) &&
        Reflect.ownKeys(input).length === fields.length &&
        fields.every((field) => Object.hasOwn(input, field))
    );
}

function freezeScalars(parameters: readonly RuntimeGrinderPresetParameter[]): readonly RuntimeGrinderPresetParameter[] {
    return Object.freeze(parameters.map(({ parameterId, value }) => Object.freeze({ parameterId, value })));
}

/** Admits an entire immediate browser preset before constructing its port payload. */
export function compileRuntimeGrinderPreset(input: unknown): RuntimeGrinderPresetCompilation {
    if (
        !hasExactFields(input, PRESET_FIELDS) ||
        input.schemaVersion !== 1 ||
        input.command !== APPLY_GRINDER_PRESET_COMMAND ||
        !hasExactFields(input.target, ['trackId', 'deviceId', 'deviceType']) ||
        !hasExactFields(input.correlation, ['workletGeneration', 'controlSequence']) ||
        !hasExactFields(input.scheduling, ['targetFrame', 'deadlineFrame'])
    ) {
        return { status: 'invalid', reason: 'Runtime Grinder preset has an unsupported schema' };
    }
    if (!hasRuntimeGrinderPresetScalars(input)) {
        return { status: 'invalid', reason: 'Runtime Grinder preset scalar vectors are invalid' };
    }

    const neural = compileRuntimeGrinderNeuralPatch({
        schemaVersion: input.schemaVersion,
        command: 'apply-grinder-neural-patch',
        target: input.target,
        correlation: input.correlation,
        scheduling: input.scheduling,
        patch: input.neural,
    });
    if (neural.status === 'invalid') {
        return neural;
    }

    return {
        status: 'compiled',
        patch: Object.freeze({
            schemaVersion: 1,
            command: APPLY_GRINDER_PRESET_COMMAND,
            target: neural.patch.target,
            correlation: neural.patch.correlation,
            scheduling: neural.patch.scheduling,
            parameters: freezeScalars(input.parameters),
            overrides: freezeScalars(input.overrides),
            resetParameterIds: Object.freeze([...input.resetParameterIds]),
            neural: neural.patch.patch,
        }),
    };
}
