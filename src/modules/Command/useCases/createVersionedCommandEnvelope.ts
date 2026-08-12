import { type AppAction } from '#/utils/handlerContract';

import {
    VERSIONED_COMMAND_SCHEMA_VERSION,
    type CommandApplicationAssignedId,
    type CommandObjectReference,
    type CommandParameterUnit,
    type CommandTimeReference,
    type VersionedCommandEnvelope,
} from '../models/VersionedCommandEnvelope';

import { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';

type CreateVersionedCommandEnvelopeInput<Action extends AppAction> = {
    action: Action;
    applicationAssignedIds?: readonly CommandApplicationAssignedId[];
    availableDeviceVersions: Readonly<Record<string, string>>;
    dependencyIds?: readonly string[];
    expectedEffect: string;
    groupId?: string;
    normalizedProjectRevision: string;
    objectReferences: readonly CommandObjectReference[];
    parameterUnits: readonly CommandParameterUnit[];
    reason: string;
    seed?: number;
    time: readonly CommandTimeReference[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createVersionedCommandEnvelope<Action extends AppAction>(
    input: CreateVersionedCommandEnvelopeInput<Action>
): VersionedCommandEnvelope<Action> {
    const seed = input.seed ?? null;
    const payload: unknown = input.action.payload;
    const argumentsValue = isRecord(payload) ? structuredClone(payload) : {};
    return {
        schemaVersion: VERSIONED_COMMAND_SCHEMA_VERSION,
        commandId: crypto.randomUUID(),
        issuedAt: Date.now(),
        operation: input.action.type,
        arguments: argumentsValue,
        argumentsDigest: getVersionedCommandArgumentsDigest({
            operation: input.action.type,
            arguments: argumentsValue,
        }),
        groupId: input.groupId,
        dependencyIds: [...(input.dependencyIds ?? [])],
        reason: input.reason,
        expectedEffect: input.expectedEffect,
        objectReferences: structuredClone(input.objectReferences),
        time: structuredClone(input.time),
        parameterUnits: structuredClone(input.parameterUnits),
        seed,
        normalizedProjectRevision: input.normalizedProjectRevision,
        availableDeviceVersions: { ...input.availableDeviceVersions },
        applicationAssignedIds: structuredClone(input.applicationAssignedIds ?? []),
    };
}
