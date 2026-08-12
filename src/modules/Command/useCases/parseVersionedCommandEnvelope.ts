import {
    VERSIONED_COMMAND_SCHEMA_VERSION,
    type CommandApplicationAssignedId,
    type CommandObjectReference,
    type CommandParameterUnit,
    type CommandTimeReference,
    type VersionedCommandEnvelope,
} from '../models/VersionedCommandEnvelope';

import { executableAppActionDescriptorByType } from './executableAppActionRegistry';
import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
import { versionedCommandArgumentKeys } from './versionedCommandArgumentKeys';

type ParseVersionedCommandEnvelopeResult =
    { status: 'valid'; envelope: VersionedCommandEnvelope } | { status: 'invalid'; reason: string };

const STOCHASTIC_OPERATIONS = new Set([
    'generateChordProgression',
    'generateDrumPattern',
    'generateMelody',
    'humanizeNotes',
]);

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

const IMPORT_STEM_SET_ARGUMENT_SCHEMA = {
    type: 'object',
    properties: {
        selectionId: { type: 'string' },
        groupName: { type: 'string', minLength: 1, maxLength: 80 },
        projectTempo: { type: 'number' },
        folderId: { type: 'string' },
        folderColor: { type: 'string' },
        folderAlternativeId: { type: 'string' },
        stems: {
            type: 'array',
            minItems: 2,
            maxItems: 32,
            items: {
                type: 'object',
                properties: {
                    stemId: { type: 'string' },
                    sourceName: { type: 'string' },
                    role: { type: 'string' },
                    sourceTempo: { type: 'number' },
                    durationSeconds: { type: 'number' },
                    sourceBytes: { type: 'number' },
                    decodedBytes: { type: 'number' },
                    audioBufferId: { type: 'string' },
                    assetHash: { type: 'string' },
                    assetLeaseId: { type: 'string' },
                    trackId: { type: 'string' },
                    trackName: { type: 'string' },
                    trackGain: { type: 'number' },
                    trackPan: { type: 'number' },
                    trackColor: { type: 'string' },
                    trackAlternativeId: { type: 'string' },
                    clipId: { type: 'string' },
                },
                required: [
                    'stemId',
                    'sourceName',
                    'role',
                    'sourceTempo',
                    'durationSeconds',
                    'sourceBytes',
                    'decodedBytes',
                    'audioBufferId',
                    'trackId',
                    'trackName',
                    'trackGain',
                    'trackPan',
                    'clipId',
                ],
            },
        },
    },
    required: ['selectionId', 'groupName', 'projectTempo', 'folderId', 'stems'],
} as const;

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

function isJsonSafe(value: unknown): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(isJsonSafe);
    }
    if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        return false;
    }
    return Object.values(value).every(isJsonSafe);
}

function matchesJsonSchema(value: unknown, schemaValue: unknown): boolean {
    if (!isRecord(schemaValue)) {
        return false;
    }
    if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some((candidate) => Object.is(candidate, value))) {
        return false;
    }
    if (schemaValue.type === 'string') {
        if (typeof value !== 'string') {
            return false;
        }
        if (typeof schemaValue.minLength === 'number' && value.length < schemaValue.minLength) {
            return false;
        }
        if (typeof schemaValue.maxLength === 'number' && value.length > schemaValue.maxLength) {
            return false;
        }
        if (typeof schemaValue.pattern === 'string' && !new RegExp(schemaValue.pattern).test(value)) {
            return false;
        }
        return true;
    }
    if (schemaValue.type === 'number' || schemaValue.type === 'integer') {
        if (!isFiniteNumber(value) || (schemaValue.type === 'integer' && !Number.isInteger(value))) {
            return false;
        }
        if (typeof schemaValue.minimum === 'number' && value < schemaValue.minimum) {
            return false;
        }
        if (typeof schemaValue.maximum === 'number' && value > schemaValue.maximum) {
            return false;
        }
        return true;
    }
    if (schemaValue.type === 'boolean') {
        return typeof value === 'boolean';
    }
    if (schemaValue.type === 'array') {
        if (!Array.isArray(value)) {
            return false;
        }
        if (typeof schemaValue.minItems === 'number' && value.length < schemaValue.minItems) {
            return false;
        }
        if (typeof schemaValue.maxItems === 'number' && value.length > schemaValue.maxItems) {
            return false;
        }
        if (
            schemaValue.uniqueItems === true &&
            new Set(value.map((item) => JSON.stringify(item))).size !== value.length
        ) {
            return false;
        }
        return schemaValue.items === undefined || value.every((item) => matchesJsonSchema(item, schemaValue.items));
    }
    if (schemaValue.type === 'object') {
        if (!isRecord(value)) {
            return false;
        }
        const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {};
        if (!hasOnlyKeys(value, Object.keys(properties))) {
            return false;
        }
        const required = Array.isArray(schemaValue.required) ? schemaValue.required : [];
        if (!required.every((key) => typeof key === 'string' && Object.hasOwn(value, key))) {
            return false;
        }
        return Object.entries(properties).every(
            ([key, propertySchema]) => !Object.hasOwn(value, key) || matchesJsonSchema(value[key], propertySchema)
        );
    }
    return false;
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

function hasValidArguments(operation: string, value: unknown): boolean {
    if (!isRecord(value) || !isJsonSafe(value)) {
        return false;
    }
    if (operation === 'humanizeNotes') {
        const allowedKeys = ['clipId', 'amount', 'velocityAmount', 'seed'];
        return (
            hasOnlyKeys(value, allowedKeys) &&
            isNonEmptyString(value.clipId) &&
            isFiniteNumber(value.amount) &&
            (value.velocityAmount === undefined || isFiniteNumber(value.velocityAmount)) &&
            (value.seed === undefined || isFiniteNumber(value.seed))
        );
    }
    if (operation === 'importStemSet') {
        return matchesJsonSchema(value, IMPORT_STEM_SET_ARGUMENT_SCHEMA);
    }
    const descriptor = executableAppActionDescriptorByType.get(operation);
    if (!descriptor) {
        return false;
    }
    const allowedKeys = versionedCommandArgumentKeys[descriptor.actionType];
    if (!hasOnlyKeys(value, allowedKeys)) {
        return false;
    }
    if (Object.keys(descriptor.parameters.properties).length === 0) {
        return Object.keys(value).length === 0;
    }
    if (!descriptor.parameters.required.every((argument) => Object.hasOwn(value, argument))) {
        return false;
    }
    return Object.entries(descriptor.parameters.properties).every(
        ([argument, schema]) => !Object.hasOwn(value, argument) || matchesJsonSchema(value[argument], schema)
    );
}

function hasCompleteReferenceMetadata(
    argumentsValue: Record<string, unknown>,
    references: readonly CommandObjectReference[]
): boolean {
    for (const [argument, value] of Object.entries(argumentsValue)) {
        if (argument.endsWith('Id') && typeof value === 'string') {
            if (!references.some((reference) => reference.argument === argument && reference.id === value)) {
                return false;
            }
        }
        if (argument.endsWith('Ids') && Array.isArray(value)) {
            for (const id of value) {
                if (
                    typeof id === 'string' &&
                    !references.some((reference) => reference.argument === argument && reference.id === id)
                ) {
                    return false;
                }
            }
        }
    }
    return true;
}

function hasCompleteUnitMetadata(
    argumentsValue: Record<string, unknown>,
    parameterUnits: readonly CommandParameterUnit[],
    time: readonly CommandTimeReference[]
): boolean {
    return Object.entries(argumentsValue).every(([argument, value]) => {
        if (argument === 'seed' || typeof value !== 'number') {
            return true;
        }
        return (
            parameterUnits.some((entry) => entry.argument === argument) ||
            time.some((entry) => entry.argument === argument)
        );
    });
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
        !hasCompleteReferenceMetadata(value.arguments, value.objectReferences) ||
        !hasCompleteUnitMetadata(value.arguments, value.parameterUnits, value.time)
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
    if (
        !Array.isArray(value.applicationAssignedIds) ||
        !value.applicationAssignedIds.every(isApplicationAssignedId) ||
        !isRecord(argumentsValue) ||
        value.applicationAssignedIds.some(
            ({ argument, value: assignedValue }) => argumentsValue[argument] !== assignedValue
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
