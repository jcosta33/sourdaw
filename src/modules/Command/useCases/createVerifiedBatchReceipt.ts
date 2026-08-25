import { type AppAction } from '#/utils/handlerContract';

import {
    type CommandBatchDynamicEffects,
    type VersionedCommandBatchEnvelope,
} from '../models/VersionedCommandBatchEnvelope';
import { type VersionedCommandEnvelope, type VersionedCommandReceipt } from '../models/VersionedCommandEnvelope';

import { buildSemanticProjectDiff } from './buildSemanticProjectDiff';
import { getVersionedCommandTargetReferences } from './getVersionedCommandTargetReferences';

export const VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION = 1 as const;

type BatchExecutionObservation = {
    status:
        | 'committed'
        | 'committed-with-warning'
        | 'executed'
        | 'executed-with-warning'
        | 'no-op'
        | 'ambiguous'
        | 'rejected'
        | 'conflicted'
        | 'cancelled'
        | 'failed';
    actions: ReadonlyArray<{
        action: AppAction;
        receipt?: VersionedCommandReceipt;
    }>;
    reason?: string;
    warning?: string;
    warningDetails?: ReadonlyArray<{
        kind: 'semantic-cleanup' | 'observer' | 'history' | 'external-effect';
        message: string;
        commandId?: string;
        pendingEffect?: {
            commandId: string;
            operation: AppAction['type'];
            reason: string;
            state: 'pending';
        } & (
            | { kind: 'runtime-graph'; remediation: 'retry' | 'repair' }
            | { kind: 'external-effect'; remediation: 'reconcile' | 'manual-repair' }
        );
    }>;
    failureKind?: 'verification';
};

type CreateVerifiedBatchReceiptInput = {
    envelope: VersionedCommandBatchEnvelope;
    observedBaseRevision: string | null;
    receiptWarnings?: readonly string[];
    resultingRevision: string | null;
    result: BatchExecutionObservation;
};

type RevisionDocument = {
    docId: string;
    heads: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRevision(normalizedRevision: string) {
    let documentIdentityEpoch: number | null = null;
    let mutationEpoch: number | null = null;
    let documents: RevisionDocument[] = [];
    try {
        const parsed: unknown = JSON.parse(normalizedRevision);
        if (isRecord(parsed)) {
            documentIdentityEpoch =
                typeof parsed.documentIdentityEpoch === 'number' ? parsed.documentIdentityEpoch : null;
            mutationEpoch = typeof parsed.mutationEpoch === 'number' ? parsed.mutationEpoch : null;
            if (Array.isArray(parsed.documents)) {
                documents = parsed.documents.flatMap((document): RevisionDocument[] => {
                    if (!isRecord(document) || typeof document.docId !== 'string' || !Array.isArray(document.heads)) {
                        return [];
                    }
                    const heads = document.heads.filter((head): head is string => typeof head === 'string').toSorted();
                    return [{ docId: document.docId, heads }];
                });
            }
        }
    } catch {
        // Legacy and test providers may expose an opaque revision token. The
        // normalized token remains authoritative even when no heads can be projected.
    }
    return {
        normalizedRevision,
        documentIdentityEpoch,
        mutationEpoch,
        documents: documents.toSorted((left, right) => left.docId.localeCompare(right.docId)),
    };
}

function commandAffectedIds(command: VersionedCommandEnvelope): string[] {
    return [
        ...getVersionedCommandTargetReferences(command).map(({ id }) => id),
        ...command.applicationAssignedIds.map(({ value }) => value),
    ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .toSorted();
}

function committedDynamicEffects(input: {
    envelope: VersionedCommandBatchEnvelope;
    executedCommandIds: ReadonlySet<string>;
}): CommandBatchDynamicEffects | undefined {
    const dynamicEffects = input.envelope.dynamicEffects;
    if (!dynamicEffects) {
        return undefined;
    }
    if (dynamicEffects.commandEffects) {
        const commandEffects = dynamicEffects.commandEffects.filter(({ commandId }) =>
            input.executedCommandIds.has(commandId)
        );
        if (commandEffects.length === 0) {
            return undefined;
        }
        return {
            affectedTrackIds: [...new Set(commandEffects.flatMap(({ effects }) => effects.affectedTrackIds ?? []))],
            affectedClipIds: [...new Set(commandEffects.flatMap(({ effects }) => effects.affectedClipIds ?? []))],
            affectedTargetIds: [...new Set(commandEffects.flatMap(({ effects }) => effects.affectedTargetIds ?? []))],
            automationPoints: commandEffects.reduce((sum, { effects }) => sum + (effects.automationPoints ?? 0), 0),
            deletedObjects: commandEffects.reduce((sum, { effects }) => sum + (effects.deletedObjects ?? 0), 0),
            commandEffects,
        };
    }
    if (input.executedCommandIds.size !== input.envelope.commands.length) {
        return undefined;
    }
    return dynamicEffects;
}

function dynamicAffectedIds(dynamicEffects: CommandBatchDynamicEffects | undefined): string[] {
    if (!dynamicEffects) {
        return [];
    }
    return [
        ...(dynamicEffects.affectedTrackIds ?? []),
        ...(dynamicEffects.affectedClipIds ?? []),
        ...(dynamicEffects.affectedTargetIds ?? []),
    ];
}

function actualBatchOutcome(result: BatchExecutionObservation) {
    if (
        result.status === 'committed-with-warning' &&
        result.warningDetails?.some(({ kind }) => kind === 'external-effect') === true
    ) {
        return 'partially-committed' as const;
    }
    if (result.status === 'conflicted' && result.failureKind === 'verification') {
        return 'verification-failed' as const;
    }
    return result.status;
}

function commandOutcome(input: {
    commandId: string;
    result: BatchExecutionObservation;
    executedCommandIds: ReadonlySet<string>;
}) {
    if (input.result.status === 'committed' || input.result.status === 'committed-with-warning') {
        return input.executedCommandIds.has(input.commandId) ? ('committed' as const) : ('no-op' as const);
    }
    if (input.result.status === 'executed' || input.result.status === 'executed-with-warning') {
        return input.executedCommandIds.has(input.commandId) ? ('executed' as const) : ('no-op' as const);
    }
    if (input.result.status === 'no-op') {
        return 'no-op' as const;
    }
    if (input.result.status === 'ambiguous') {
        return 'unknown' as const;
    }
    return 'not-applied' as const;
}

function collectArtifactLinks(
    commands: readonly VersionedCommandEnvelope[],
    failedExternalEffectCommandIds: ReadonlySet<string>
) {
    const render: Array<{ commandId: string; jobId: string }> = [];
    const analysis: Array<{ analysisId: string; commandId: string }> = [];
    for (const command of commands) {
        if (failedExternalEffectCommandIds.has(command.commandId)) {
            continue;
        }
        const jobs = Array.isArray(command.arguments.jobs) ? command.arguments.jobs : [];
        for (const job of jobs) {
            if (isRecord(job) && typeof job.jobId === 'string') {
                render.push({ commandId: command.commandId, jobId: job.jobId });
            }
        }
        if (typeof command.arguments.analysisId === 'string') {
            analysis.push({ analysisId: command.arguments.analysisId, commandId: command.commandId });
        }
        const analysisIds = Array.isArray(command.arguments.analysisIds) ? command.arguments.analysisIds : [];
        for (const analysisId of analysisIds) {
            if (typeof analysisId === 'string') {
                analysis.push({ analysisId, commandId: command.commandId });
            }
        }
    }
    return { render, analysis };
}

function createModelSummary(input: {
    affectedIds: readonly string[];
    compensationAvailable: boolean;
    executedCommandCount: number;
    outcome: ReturnType<typeof actualBatchOutcome>;
    resultingRevisionAvailable: boolean;
}): string {
    if (input.outcome === 'committed') {
        if (!input.resultingRevisionAvailable) {
            return `Committed ${String(input.executedCommandCount)} commands atomically, but resulting project heads are unavailable.`;
        }
        const compensation = input.compensationAvailable ? 'compensation is available' : 'compensation is unavailable';
        return `Committed ${String(input.executedCommandCount)} commands atomically; ${String(input.affectedIds.length)} targets changed; ${compensation}.`;
    }
    if (input.outcome === 'partially-committed') {
        return `Committed ${String(input.executedCommandCount)} commands atomically, but at least one non-atomic follow-up effect failed.`;
    }
    if (input.outcome === 'committed-with-warning') {
        return `Committed ${String(input.executedCommandCount)} commands atomically; reporting completed with warnings.`;
    }
    if (input.outcome === 'no-op') {
        return 'No commands changed project state.';
    }
    if (input.outcome === 'verification-failed') {
        return 'Verification failed; the project batch was not committed.';
    }
    if (input.outcome === 'ambiguous') {
        return 'The commit outcome is ambiguous and must be reconciled before reporting success.';
    }
    return `Batch outcome: ${input.outcome}; no project change is reported as successful.`;
}

export function createVerifiedBatchReceipt(input: CreateVerifiedBatchReceiptInput) {
    const executedByCommandId = new Map(
        input.result.actions.flatMap((entry) =>
            entry.receipt ? [[entry.receipt.commandId, entry.receipt] as const] : []
        )
    );
    const executedCommandIds = new Set(executedByCommandId.keys());
    const historyPublicationFailed = input.result.warningDetails?.some(({ kind }) => kind === 'history') === true;
    const commandOutcomes = input.envelope.commands.map((command) => {
        const outcome = commandOutcome({ commandId: command.commandId, result: input.result, executedCommandIds });
        const receipt = executedByCommandId.get(command.commandId);
        const affectedIds = outcome === 'committed' || outcome === 'executed' ? commandAffectedIds(command) : [];
        return {
            commandId: command.commandId,
            operation: command.operation,
            outcome,
            affectedIds,
            compensationAvailable: !historyPublicationFailed && receipt?.compensation?.available === true,
        };
    });
    const appliedCommands = input.envelope.commands.filter((command) => executedCommandIds.has(command.commandId));
    const filteredDynamicEffects =
        input.result.status === 'committed' || input.result.status === 'committed-with-warning'
            ? committedDynamicEffects({ envelope: input.envelope, executedCommandIds })
            : undefined;
    const affectedIds = [
        ...commandOutcomes.flatMap((command) => command.affectedIds),
        ...dynamicAffectedIds(filteredDynamicEffects),
    ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .toSorted();
    const createdBindings = appliedCommands
        .flatMap((command) =>
            command.applicationAssignedIds.map(({ argument, value }) => {
                const declaredBinding = input.envelope.batchLocalBindings.find(
                    (binding) =>
                        binding.producerCommandId === command.commandId && binding.producerArgument === argument
                );
                return {
                    commandId: command.commandId,
                    argument,
                    value,
                    ...(declaredBinding ? { bindingId: declaredBinding.bindingId } : {}),
                };
            })
        )
        .toSorted((left, right) =>
            `${left.commandId}:${left.argument}:${left.value}`.localeCompare(
                `${right.commandId}:${right.argument}:${right.value}`
            )
        );
    const compensationCommandIds = commandOutcomes
        .filter((command) => command.compensationAvailable)
        .map((command) => command.commandId);
    const outcome = actualBatchOutcome(input.result);
    const warnings = [...(input.result.warning ? [input.result.warning] : []), ...(input.receiptWarnings ?? [])];
    const errors = input.result.reason ? [input.result.reason] : [];
    const semanticDiff =
        input.result.status === 'committed' || input.result.status === 'committed-with-warning'
            ? buildSemanticProjectDiff({
                  envelope: { ...input.envelope, commands: appliedCommands, dynamicEffects: filteredDynamicEffects },
                  recoveryByCommandId: Object.fromEntries(
                      commandOutcomes.map((command) => [
                          command.commandId,
                          command.compensationAvailable ? 'inverse' : 'irreversible',
                      ])
                  ),
                  warnings,
              })
            : null;
    const compensationAvailable =
        appliedCommands.length > 0 && compensationCommandIds.length === appliedCommands.length;
    const failedExternalEffectCommandIds = new Set(
        input.result.warningDetails?.flatMap(({ commandId, kind }) =>
            kind === 'external-effect' && commandId ? [commandId] : []
        ) ?? []
    );
    const pendingEffects =
        input.result.warningDetails?.flatMap(({ pendingEffect }) => (pendingEffect ? [pendingEffect] : [])) ?? [];
    const hasFailedExternalEffect =
        input.result.warningDetails?.some(({ kind }) => kind === 'external-effect') === true;

    return {
        schemaVersion: VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION,
        runId: input.envelope.runId,
        batchId: input.envelope.batchId,
        outcome,
        atomicity: hasFailedExternalEffect ? ('durable-atomic-with-non-atomic-effects' as const) : ('atomic' as const),
        base: parseRevision(input.envelope.baseRevision),
        observedBase: input.observedBaseRevision === null ? null : parseRevision(input.observedBaseRevision),
        resulting: input.resultingRevision === null ? null : parseRevision(input.resultingRevision),
        commandOutcomes,
        affectedIds,
        createdBindings,
        warnings,
        errors,
        pendingEffects,
        links: collectArtifactLinks(appliedCommands, failedExternalEffectCommandIds),
        compensation: {
            available: compensationAvailable,
            commandIds: compensationCommandIds,
        },
        semanticDiff,
        modelSummary: createModelSummary({
            affectedIds,
            compensationAvailable,
            executedCommandCount: appliedCommands.length,
            outcome,
            resultingRevisionAvailable: input.resultingRevision !== null,
        }),
    };
}
