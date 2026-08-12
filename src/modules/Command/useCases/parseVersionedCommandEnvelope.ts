import {
    VERSIONED_COMMAND_SCHEMA_VERSION,
    type CommandApplicationAssignedId,
    type CommandObjectReference,
    type CommandParameterUnit,
    type CommandTimeReference,
    type VersionedCommandEnvelope,
} from '../models/VersionedCommandEnvelope';

import { compileCommandArgumentMetadata } from './commandArgumentMetadata';
import { isExecutableAppActionType } from './executableAppActionRegistry';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
import { COMMAND_APPLICATION_ID_RULES } from './materializeCommandApplicationIds';
import { validateVersionedCommandArguments } from './versionedCommandArgumentKeys';

type ParseVersionedCommandEnvelopeResult =
    { status: 'valid'; envelope: VersionedCommandEnvelope } | { status: 'invalid'; reason: string };

const STOCHASTIC_OPERATIONS = new Set([
    'generateChordProgression',
    'generateDrumPattern',
    'generateMelody',
    'humanizeNotes',
]);

// These actions still derive semantic output, nested identities, or external
// model results after the serialized envelope has been fixed. They remain
// available through their owning in-process workflows, but are not admitted at
// the replayable serialized-command boundary until those results are fully
// materialized into the command contract.
const NONDETERMINISTIC_EXECUTABLE_OPERATIONS = new Set([
    'duplicateClip',
    'duplicateClipToNextBar',
    'duplicateTrack',
    'glueClips',
    'splitClip',
]);

const ADDITIONAL_SERIALIZED_OPERATIONS = new Set(['addNotes']);

const ENVELOPE_KEYS = [
    'schemaVersion',
    'commandId',
    'issuedAt',
    'operation',
    'arguments',
    'argumentsDigest',
    'groupId',
    'dependencyIds',
    'reason',
    'expectedEffect',
    'objectReferences',
    'time',
    'parameterUnits',
    'seed',
    'normalizedProjectRevision',
    'availableDeviceVersions',
    'applicationAssignedIds',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isUniqueStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
}

function isObjectReference(value: unknown): value is CommandObjectReference {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['argument', 'id', 'scope']) &&
        isNonEmptyString(value.argument) &&
        isNonEmptyString(value.id) &&
        (value.scope === 'stable' || value.scope === 'batch-local')
    );
}

function isTimeReference(value: unknown): value is CommandTimeReference {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['argument', 'domain', 'unit', 'value']) &&
        isNonEmptyString(value.argument) &&
        (value.domain === 'musical' || value.domain === 'absolute') &&
        (value.unit === 'beats' ||
            value.unit === 'seconds' ||
            value.unit === 'milliseconds' ||
            value.unit === 'samples') &&
        isFiniteNumber(value.value)
    );
}

function isParameterUnit(value: unknown): value is CommandParameterUnit {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['argument', 'unit']) &&
        isNonEmptyString(value.argument) &&
        isNonEmptyString(value.unit)
    );
}

function isApplicationAssignedId(value: unknown): value is CommandApplicationAssignedId {
    return (
        isRecord(value) &&
        hasOnlyKeys(value, ['argument', 'value']) &&
        isNonEmptyString(value.argument) &&
        isNonEmptyString(value.value)
    );
}

function getArgumentPathValue(argumentsValue: Record<string, unknown>, argument: string): unknown {
    let current: unknown = argumentsValue;
    for (const part of argument.split('.')) {
        const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d+)\])?$/.exec(part);
        if (!match || !isRecord(current) || !Object.hasOwn(current, match[1]!)) {
            return undefined;
        }
        current = current[match[1]!];
        if (match[2] !== undefined) {
            if (!Array.isArray(current)) {
                return undefined;
            }
            current = current[Number(match[2])];
        }
    }
    return current;
}

function hasValidArguments(operation: string, value: unknown): boolean {
    if (!isRecord(value)) {
        return false;
    }
    if (isExecutableAppActionType(operation)) {
        return getExecutableCommandRegistration(operation).runtimeSchema.validate(value);
    }
    return validateVersionedCommandArguments(operation, value);
}

function isDeterministicSerializedOperation(operation: string, value: unknown): boolean {
    if (
        (!isExecutableAppActionType(operation) && !ADDITIONAL_SERIALIZED_OPERATIONS.has(operation)) ||
        NONDETERMINISTIC_EXECUTABLE_OPERATIONS.has(operation)
    ) {
        return false;
    }
    if (!isRecord(value)) {
        return false;
    }
    if (operation === 'addTrack') {
        return (
            isNonEmptyString(value.id) &&
            isNonEmptyString(value.initialAlternativeId) &&
            isNonEmptyString(value.color) &&
            (value.kind !== 'midi' || isNonEmptyString(value.initialDeviceId))
        );
    }
    if (operation === 'createBus') {
        return (
            isNonEmptyString(value.busId) &&
            isNonEmptyString(value.initialAlternativeId) &&
            isNonEmptyString(value.color)
        );
    }
    return true;
}

function getRequiredApplicationAssignedIdArguments(
    operation: string,
    argumentsValue: Record<string, unknown>
): string[] {
    if (operation === 'addNotes') {
        const notes = argumentsValue.notes;
        if (!Array.isArray(notes)) {
            return [];
        }
        return notes.map((_, index) => `notes[${String(index)}].id`);
    }
    if (operation === 'addTrack') {
        return argumentsValue.kind === 'midi'
            ? ['id', 'initialAlternativeId', 'initialDeviceId']
            : ['id', 'initialAlternativeId'];
    }
    if (operation === 'createBus') {
        return ['busId', 'initialAlternativeId'];
    }
    if (operation === 'armTrack') {
        return typeof argumentsValue.midiInputOwnerId === 'string' ? ['midiInputOwnerId'] : [];
    }
    const rule = COMMAND_APPLICATION_ID_RULES[operation as keyof typeof COMMAND_APPLICATION_ID_RULES];
    if (!rule || typeof argumentsValue[rule.argument] !== 'string') {
        return [];
    }
    return [rule.argument];
}

function hasCanonicalArgumentMetadata(
    argumentsValue: Record<string, unknown>,
    references: readonly CommandObjectReference[],
    parameterUnits: readonly CommandParameterUnit[],
    time: readonly CommandTimeReference[]
): boolean {
    const expected = compileCommandArgumentMetadata(argumentsValue);
    return (
        JSON.stringify(references) === JSON.stringify(expected.objectReferences) &&
        JSON.stringify(parameterUnits) === JSON.stringify(expected.parameterUnits) &&
        JSON.stringify(time) === JSON.stringify(expected.time)
    );
}

function validateEnvelope(value: unknown): ParseVersionedCommandEnvelopeResult {
    if (!isRecord(value) || !hasOnlyKeys(value, ENVELOPE_KEYS)) {
        return { status: 'invalid', reason: 'Command envelope must contain only declared fields' };
    }
    if (value.schemaVersion !== VERSIONED_COMMAND_SCHEMA_VERSION) {
        return { status: 'invalid', reason: 'Unsupported command envelope schema version' };
    }
    if (!isNonEmptyString(value.commandId) || !isFiniteNumber(value.issuedAt)) {
        return { status: 'invalid', reason: 'Command identity is invalid' };
    }
    if (!isNonEmptyString(value.operation) || !hasValidArguments(value.operation, value.arguments)) {
        return { status: 'invalid', reason: 'Command operation or arguments are not allowlisted' };
    }
    if (!isDeterministicSerializedOperation(value.operation, value.arguments)) {
        return { status: 'invalid', reason: 'Command operation is not deterministic at the serialized boundary' };
    }
    if (
        !isNonEmptyString(value.argumentsDigest) ||
        value.argumentsDigest !==
            getVersionedCommandArgumentsDigest({ operation: value.operation, arguments: value.arguments })
    ) {
        return { status: 'invalid', reason: 'Command arguments failed integrity validation' };
    }
    if (value.groupId !== undefined && !isNonEmptyString(value.groupId)) {
        return { status: 'invalid', reason: 'Command group ID is invalid' };
    }
    if (!isUniqueStringArray(value.dependencyIds) || value.dependencyIds.includes(value.commandId)) {
        return { status: 'invalid', reason: 'Command dependencies are invalid' };
    }
    if (!isNonEmptyString(value.reason) || !isNonEmptyString(value.expectedEffect)) {
        return { status: 'invalid', reason: 'Command reason and expected effect are required' };
    }
    if (!Array.isArray(value.objectReferences) || !value.objectReferences.every(isObjectReference)) {
        return { status: 'invalid', reason: 'Command object references are invalid' };
    }
    if (!Array.isArray(value.time) || !value.time.every(isTimeReference)) {
        return { status: 'invalid', reason: 'Command time references are invalid' };
    }
    if (!Array.isArray(value.parameterUnits) || !value.parameterUnits.every(isParameterUnit)) {
        return { status: 'invalid', reason: 'Command parameter units are invalid' };
    }
    if (
        !isRecord(value.arguments) ||
        !hasCanonicalArgumentMetadata(value.arguments, value.objectReferences, value.parameterUnits, value.time)
    ) {
        return { status: 'invalid', reason: 'Command argument metadata is incomplete' };
    }
    if (value.seed !== null && !isFiniteNumber(value.seed)) {
        return { status: 'invalid', reason: 'Command seed is invalid' };
    }
    if (STOCHASTIC_OPERATIONS.has(value.operation) && value.seed === null) {
        return { status: 'invalid', reason: 'Stochastic commands require an explicit seed' };
    }
    if (
        value.seed !== null &&
        isRecord(value.arguments) &&
        Object.hasOwn(value.arguments, 'seed') &&
        value.arguments.seed !== value.seed
    ) {
        return { status: 'invalid', reason: 'Command seed does not match its arguments' };
    }
    if (!isNonEmptyString(value.normalizedProjectRevision) || !isRecord(value.availableDeviceVersions)) {
        return { status: 'invalid', reason: 'Command execution context is invalid' };
    }
    if (
        !Object.entries(value.availableDeviceVersions).every(
            ([key, version]) => isNonEmptyString(key) && isNonEmptyString(version)
        )
    ) {
        return { status: 'invalid', reason: 'Available device versions are invalid' };
    }
    const argumentsValue = value.arguments;
    const applicationAssignedIds = value.applicationAssignedIds;
    const requiredApplicationAssignedIdArguments = isRecord(argumentsValue)
        ? getRequiredApplicationAssignedIdArguments(value.operation, argumentsValue)
        : [];
    if (
        !Array.isArray(applicationAssignedIds) ||
        !applicationAssignedIds.every(isApplicationAssignedId) ||
        !isRecord(argumentsValue) ||
        new Set(applicationAssignedIds.map(({ argument }) => argument)).size !== applicationAssignedIds.length ||
        applicationAssignedIds.some(({ argument }) => !requiredApplicationAssignedIdArguments.includes(argument)) ||
        applicationAssignedIds.some(
            ({ argument, value: assignedValue }) => getArgumentPathValue(argumentsValue, argument) !== assignedValue
        ) ||
        requiredApplicationAssignedIdArguments.some(
            (argument) => applicationAssignedIds.filter((entry) => entry.argument === argument).length !== 1
        )
    ) {
        return { status: 'invalid', reason: 'Application-assigned command IDs are invalid' };
    }
    return { status: 'valid', envelope: value as VersionedCommandEnvelope };
}

export function parseVersionedCommandEnvelope(serialized: string): ParseVersionedCommandEnvelopeResult {
    let value: unknown;
    try {
        value = JSON.parse(serialized);
    } catch {
        return { status: 'invalid', reason: 'Command envelope is not valid JSON' };
    }
    return validateEnvelope(value);
}
