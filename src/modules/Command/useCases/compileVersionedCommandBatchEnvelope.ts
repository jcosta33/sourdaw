import {
    VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
    type CommandBatchAuthority,
    type CommandBatchLocalBinding,
    type CommandBatchMode,
    type CommandBatchRange,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope } from '../models/VersionedCommandEnvelope';

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

function getScopeTargetIds(commands: readonly VersionedCommandEnvelope[]): string[] {
    const targetIds = new Set<string>();
    for (const command of commands) {
        for (const reference of getVersionedCommandTargetReferences(command)) {
            if (reference.scope === 'stable') {
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
    const effects = getVersionedCommandBatchEffects(commands);
    const protectedTargetIds = [...new Set(input.protectedTargetIds ?? [])];
    const scope = {
        targetIds: getScopeTargetIds(commands).filter((targetId) => !protectedTargetIds.includes(targetId)),
        targetRanges: getTargetRanges(commands),
        protectedTargetIds,
        protectedRanges: structuredClone(input.protectedRanges ?? []),
    };
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
            ...(scope.targetIds.length > 0 ? [{ kind: 'targets-exist' as const, targetIds: scope.targetIds }] : []),
        ],
        commands,
        postconditions: [
            { kind: 'project-invariants-valid' },
            { kind: 'audio-graph-valid' },
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
