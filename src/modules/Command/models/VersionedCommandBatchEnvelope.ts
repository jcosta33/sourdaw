import { type VersionedCommandEnvelope } from './VersionedCommandEnvelope';

export const VERSIONED_COMMAND_BATCH_SCHEMA_VERSION = 1 as const;

export type CommandBatchMode = 'preview' | 'commit';

export type CommandBatchRange = {
    startBeat: number;
    endBeat: number;
};

export type CommandBatchScope = {
    targetIds: readonly string[];
    targetRanges: readonly CommandBatchRange[];
    protectedTargetIds: readonly string[];
    protectedRanges: readonly CommandBatchRange[];
};

export type CommandBatchConditionKind =
    | 'project-revision'
    | 'targets-exist'
    | 'targets-absent'
    | 'targets-unchanged'
    | 'ranges-unlocked'
    | 'project-invariants-valid'
    | 'audio-graph-valid';

export type CommandBatchCondition = {
    kind: CommandBatchConditionKind;
    targetIds?: readonly string[];
    value?: string | number | boolean;
};

export type CommandBatchDependency = {
    commandId: string;
    dependsOn: readonly string[];
};

export type CommandBatchLocalBinding = {
    bindingId: string;
    producerArgument: string;
    producerCommandId: string;
};

export type CommandBatchGrants = {
    allowedOperationPrefixes: readonly string[];
    create: boolean;
    delete: boolean;
    routing: boolean;
    tempo: boolean;
    master: boolean;
    file: boolean;
    audioUpload: boolean;
    remoteGeneration: boolean;
    autoCommit: boolean;
};

export type CommandBatchBudgets = {
    maxCommands: number;
    maxCreatedTracks: number;
    maxDeletedObjects: number;
    maxAffectedTracks: number;
    maxAffectedClips: number;
    maxAutomationPoints: number;
    maxImportedAssets: number;
    maxRenderJobs: number;
};

export type CommandBatchAuthority = {
    projectId: string;
    baseRevision: string;
    scope: CommandBatchScope;
    grants: CommandBatchGrants;
    budgets: CommandBatchBudgets;
};

export type VersionedCommandBatchEnvelope = {
    schemaVersion: typeof VERSIONED_COMMAND_BATCH_SCHEMA_VERSION;
    runId: string;
    batchId: string;
    projectId: string;
    baseRevision: string;
    idempotencyKey: string;
    intent: string;
    mode: CommandBatchMode;
    scope: CommandBatchScope;
    preconditions: readonly CommandBatchCondition[];
    commands: readonly VersionedCommandEnvelope[];
    postconditions: readonly CommandBatchCondition[];
    dependencies: readonly CommandBatchDependency[];
    batchLocalBindings: readonly CommandBatchLocalBinding[];
    grants: CommandBatchGrants;
    budgets: CommandBatchBudgets;
};
