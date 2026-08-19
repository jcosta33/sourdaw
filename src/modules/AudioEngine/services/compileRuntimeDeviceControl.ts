import { type RuntimeDeviceControlCompilation } from '../models/RuntimeDeviceControl';

const MAX_ID_LENGTH = 128;

type UnknownRecord = Record<string, unknown>;

function invalid(reason: string): RuntimeDeviceControlCompilation {
    return { status: 'invalid', reason };
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return isNonNegativeSafeInteger(value) && value > 0;
}

/**
 * Validates and freezes one fallback control before it crosses into an
 * AudioWorklet. The processor performs a scalar-only mirror check; it never
 * compiles or freezes arbitrary input on its render-adjacent path.
 */
export function compileRuntimeDeviceControl(
    input: unknown,
    allowedParameterIds: readonly string[]
): RuntimeDeviceControlCompilation {
    if (
        !isRecord(input) ||
        !hasOnlyKeys(input, ['schemaVersion', 'command', 'target', 'value', 'correlation', 'scheduling'])
    ) {
        return invalid('Runtime device control has an unsupported schema');
    }
    if (input.schemaVersion !== 1 || input.command !== 'set-fallback-param') {
        return invalid('Runtime device control schema version or command is unsupported');
    }
    if (!isRecord(input.target) || !hasOnlyKeys(input.target, ['trackId', 'deviceId', 'deviceType', 'parameterId'])) {
        return invalid('Runtime device control target has an unsupported schema');
    }
    if (
        !isBoundedId(input.target.trackId) ||
        !isBoundedId(input.target.deviceId) ||
        !isBoundedId(input.target.deviceType) ||
        !isBoundedId(input.target.parameterId)
    ) {
        return invalid('Runtime device control target is invalid');
    }
    if (!allowedParameterIds.includes(input.target.parameterId)) {
        return invalid('Runtime device control parameter is not declared by the live device schema');
    }
    if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
        return invalid('Runtime device control value is invalid');
    }
    if (!isRecord(input.correlation) || !hasOnlyKeys(input.correlation, ['workletGeneration', 'controlSequence'])) {
        return invalid('Runtime device control correlation has an unsupported schema');
    }
    if (
        !isPositiveSafeInteger(input.correlation.workletGeneration) ||
        !isPositiveSafeInteger(input.correlation.controlSequence)
    ) {
        return invalid('Runtime device control correlation is invalid');
    }
    if (!isRecord(input.scheduling) || !hasOnlyKeys(input.scheduling, ['targetFrame', 'deadlineFrame'])) {
        return invalid('Runtime device control scheduling has an unsupported schema');
    }
    const { targetFrame, deadlineFrame } = input.scheduling;
    const hasImmediateTiming = targetFrame === null && deadlineFrame === null;
    const hasScheduledTiming = isNonNegativeSafeInteger(targetFrame) && isNonNegativeSafeInteger(deadlineFrame);
    if (!hasImmediateTiming && (!hasScheduledTiming || targetFrame > deadlineFrame)) {
        return invalid('Runtime device control scheduling is invalid');
    }

    return {
        status: 'compiled',
        control: Object.freeze({
            schemaVersion: 1,
            command: 'set-fallback-param',
            target: Object.freeze({
                trackId: input.target.trackId,
                deviceId: input.target.deviceId,
                deviceType: input.target.deviceType,
                parameterId: input.target.parameterId,
            }),
            value: input.value,
            correlation: Object.freeze({
                workletGeneration: input.correlation.workletGeneration,
                controlSequence: input.correlation.controlSequence,
            }),
            scheduling: Object.freeze({ targetFrame, deadlineFrame }),
        }),
    };
}
