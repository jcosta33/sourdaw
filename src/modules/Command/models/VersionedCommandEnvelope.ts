import { type AppAction } from '#/utils/handlerContract';

export const VERSIONED_COMMAND_SCHEMA_VERSION = 1 as const;

export type CommandObjectReference = {
    argument: string;
    id: string;
    scope: 'stable' | 'batch-local';
};

export type CommandTimeReference = {
    argument: string;
    domain: 'musical' | 'absolute';
    unit: 'beats' | 'seconds' | 'milliseconds' | 'samples';
    value: number;
};

export type CommandParameterUnit = {
    argument: string;
    unit: string;
};

export type CommandApplicationAssignedId = {
    argument: string;
    value: string;
};

export type VersionedCommandEnvelope<Action extends AppAction = AppAction> = {
    schemaVersion: typeof VERSIONED_COMMAND_SCHEMA_VERSION;
    commandId: string;
    issuedAt: number;
    operation: Action['type'];
    arguments: Readonly<Record<string, unknown>>;
    argumentsDigest: string;
    groupId?: string;
    dependencyIds: readonly string[];
    reason: string;
    expectedEffect: string;
    objectReferences: readonly CommandObjectReference[];
    time: readonly CommandTimeReference[];
    parameterUnits: readonly CommandParameterUnit[];
    seed: number | null;
    normalizedProjectRevision: string;
    availableDeviceVersions: Readonly<Record<string, string>>;
    applicationAssignedIds: readonly CommandApplicationAssignedId[];
};

export type VersionedCommandReceipt = {
    commandId: string;
    schemaVersion: typeof VERSIONED_COMMAND_SCHEMA_VERSION;
    applicationAssigned: {
        ids: ReadonlyArray<{ field: 'commandId' | 'historyId' | 'objectId'; value: string }>;
        timestamps: ReadonlyArray<{ field: 'issuedAt' | 'committedAt'; value: number }>;
    };
};
