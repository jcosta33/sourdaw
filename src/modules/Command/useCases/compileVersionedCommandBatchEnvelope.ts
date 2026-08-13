import {
    VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
    type CommandBatchAuthority,
    type CommandBatchLocalBinding,
    type CommandBatchMode,
    type CommandBatchRange,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

import { commandRequiresDynamicEffects } from './commandRequiresDynamicEffects';
import { getBatchLocalDependentTargetIds } from './getBatchLocalDependentTargetIds';
import { getVersionedCommandBatchEffects } from './getVersionedCommandBatchEffects';
import { getVersionedCommandTargetReferences } from './getVersionedCommandTargetReferences';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';
import { serializeVersionedCommandBatchEnvelope } from './serializeVersionedCommandBatchEnvelope';

type CompileVersionedCommandBatchEnvelopeInput = {
    runId: string;
    batchId: string;
    projectId: string;
    baseRevision: string;
    intent: string;
    mode?: CommandBatchMode;
    idempotencyKey?: string;
    commands: readonly string[];
    protectedTargetIds?: readonly string[];
    protectedRanges?: readonly CommandBatchRange[];
    batchLocalBindings?: readonly CommandBatchLocalBinding[];
    autoCommit?: boolean;
    dynamicEffects?: {
        affectedTrackIds?: readonly string[];
        affectedClipIds?: readonly string[];
        affectedTargetIds?: readonly string[];
        automationPoints?: number;
        deletedObjects?: number;
    };
};

type CompiledVersionedCommandBatchEnvelope = {
    serialized: string;
    authority: CommandBatchAuthority;
};

function parseCommands(serializedCommands: readonly string[]): VersionedCommandEnvelope[] {
    const commands: VersionedCommandEnvelope[] = [];
    for (const serialized of serializedCommands) {
        const parsed = parseVersionedCommandEnvelope(serialized);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        commands.push(parsed.envelope);
    }
    return commands;
}

function getScopeTargetIds(
    commands: readonly VersionedCommandEnvelope[],
    excludedTargetIds: ReadonlySet<string>
): string[] {
    const targetIds = new Set<string>();
    for (const command of commands) {
        for (const reference of getVersionedCommandTargetReferences(command)) {
            if (reference.scope === 'stable' && !excludedTargetIds.has(reference.id)) {
                targetIds.add(reference.id);
            }
        }
    }
    return [...targetIds];
}

function getTargetRanges(commands: readonly VersionedCommandEnvelope[]): CommandBatchRange[] {
    const ranges: CommandBatchRange[] = [];
    for (const command of commands) {
        const beats = command.time
            .filter((time) => time.domain === 'musical' && time.unit === 'beats')
            .map((time) => time.value);
        if (beats.length === 0) {
            continue;
        }
        ranges.push({ startBeat: Math.min(...beats), endBeat: Math.max(...beats) });
    }
    return ranges;
}

function buildEnvelope(input: CompileVersionedCommandBatchEnvelopeInput): VersionedCommandBatchEnvelope {
    const commands = parseCommands(input.commands);
    if (commands.length === 0) {
        throw new Error('Command batch requires at least one command');
    }
    if (commands.some((command) => commandRequiresDynamicEffects(command.operation)) && !input.dynamicEffects) {
        throw new Error('Command batch requires application-owned dynamic effect bounds');
    }
    const effects = getVersionedCommandBatchEffects(commands, input.dynamicEffects);
    const createdTargetIds = new Set(
        commands.flatMap((command) =>
            command.operation === 'armTrack' ? [] : command.applicationAssignedIds.map((assigned) => assigned.value)
        )
    );
    const batchLocalDependentTargetIds = getBatchLocalDependentTargetIds(commands, createdTargetIds);
    const protectedTargetIds = [...new Set(input.protectedTargetIds ?? [])];
    const dynamicTargetIds = new Set([
        ...(input.dynamicEffects?.affectedTrackIds ?? []),
        ...(input.dynamicEffects?.affectedClipIds ?? []),
        ...(input.dynamicEffects?.affectedTargetIds ?? []),
    ]);
    const protectedDynamicOverlap = protectedTargetIds.filter((targetId) => dynamicTargetIds.has(targetId));
    if (protectedDynamicOverlap.length > 0) {
        throw new Error(`Dynamic command effects target protected objects: ${protectedDynamicOverlap.join(', ')}`);
    }
    const targetIds = [
        ...new Set([
            ...getScopeTargetIds(commands, batchLocalDependentTargetIds),
            ...effects.affectedTrackIds,
            ...effects.affectedClipIds,
            ...(input.dynamicEffects?.affectedTargetIds ?? []),
        ]),
    ];
    const scope = {
        targetIds: targetIds.filter((targetId) => !protectedTargetIds.includes(targetId)),
        targetRanges: getTargetRanges(commands),
        protectedTargetIds,
        protectedRanges: structuredClone(input.protectedRanges ?? []),
    };
    const existingTargetIds = scope.targetIds.filter((targetId) => !createdTargetIds.has(targetId));
    const absentTargetIds = scope.targetIds.filter((targetId) => createdTargetIds.has(targetId));
    const grants = {
        allowedOperationPrefixes: [...new Set(commands.map((command) => command.operation))],
        create: effects.requiredGrants.has('create'),
        delete: effects.requiredGrants.has('delete'),
        routing: effects.requiredGrants.has('routing'),
        tempo: effects.requiredGrants.has('tempo'),
        master: effects.requiredGrants.has('master'),
        file: effects.requiredGrants.has('file'),
        audioUpload: effects.requiredGrants.has('audioUpload'),
        remoteGeneration: effects.requiredGrants.has('remoteGeneration'),
        autoCommit: input.autoCommit ?? false,
    };
    const budgets = {
        maxCommands: commands.length,
        maxCreatedTracks: effects.createdTracks,
        maxDeletedObjects: effects.deletedObjects,
        maxAffectedTracks: effects.affectedTrackIds.size,
        maxAffectedClips: effects.affectedClipIds.size,
        maxAutomationPoints: effects.automationPoints,
        maxImportedAssets: effects.importedAssets,
        maxRenderJobs: effects.renderJobs,
    };
    return {
        schemaVersion: VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
        runId: input.runId,
        batchId: input.batchId,
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        idempotencyKey: input.idempotencyKey ?? `${input.runId}:${input.batchId}:${input.baseRevision}`,
        intent: input.intent,
        mode: input.mode ?? 'commit',
        scope,
        preconditions: [
            { kind: 'project-revision', value: input.baseRevision },
            ...(existingTargetIds.length > 0 ? [{ kind: 'targets-exist' as const, targetIds: existingTargetIds }] : []),
            ...(absentTargetIds.length > 0 ? [{ kind: 'targets-absent' as const, targetIds: absentTargetIds }] : []),
            ...(scope.targetRanges.length > 0 ? [{ kind: 'ranges-unlocked' as const }] : []),
        ],
        commands,
        postconditions: [
            { kind: 'project-invariants-valid' },
            { kind: 'audio-graph-valid' },
            ...(absentTargetIds.length > 0 ? [{ kind: 'targets-exist' as const, targetIds: absentTargetIds }] : []),
            ...(protectedTargetIds.length > 0
                ? [{ kind: 'targets-unchanged' as const, targetIds: protectedTargetIds }]
                : []),
        ],
        dependencies: commands
            .filter((command) => command.dependencyIds.length > 0)
            .map((command) => ({ commandId: command.commandId, dependsOn: [...command.dependencyIds] })),
        batchLocalBindings: structuredClone(input.batchLocalBindings ?? []),
        grants,
        budgets,
    };
}

export function compileVersionedCommandBatchEnvelope(
    input: CompileVersionedCommandBatchEnvelopeInput
): CompiledVersionedCommandBatchEnvelope {
    const envelope = buildEnvelope(input);
    const authority = {
        projectId: envelope.projectId,
        baseRevision: envelope.baseRevision,
        scope: envelope.scope,
        grants: envelope.grants,
        budgets: envelope.budgets,
    };
    const serialized = serializeVersionedCommandBatchEnvelope(envelope);
    const validation = parseVersionedCommandBatchEnvelope(serialized, authority);
    if (validation.status === 'invalid') {
        throw new Error(validation.reason);
    }
    return { serialized, authority };
}
