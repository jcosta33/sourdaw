import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { type CommandApprovalBinding } from './commandApprovalBinding';
import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { consumeCommandApprovalBinding } from './consumeCommandApprovalBinding';
import { createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
import { executeVersionedCommandBatch } from './executeVersionedCommandBatch';
import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';
import { getVersionedCommandBatchDivergenceTargetIds } from './getVersionedCommandBatchDivergenceTargetIds';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { persistProjectCommandBatchIdempotencyCheckpoint } from './persistProjectCommandBatchIdempotencyCheckpoint';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';
import { previewVersionedCommandBatchEnvelope } from './previewVersionedCommandBatchEnvelope';
import { recordProjectCommandBatchIdempotencyCheckpoint } from './recordProjectCommandBatchIdempotencyCheckpoint';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchEnvelopeInput = {
    authority: CommandBatchAuthority;
    approvalBinding?: CommandApprovalBinding;
    /** @deprecated A boolean is not proof of exact approval and never authorizes execution. */
    confirmed?: boolean;
    serialized: string;
    options?: ExecuteOptions & {
        /** Persist caller-owned recovery state while the exact project checkpoint is being journaled. */
        onProjectCommitCheckpoint?: (result: { receipt: ReturnType<typeof createVerifiedBatchReceipt> }) => {
            promote: (result: { receipt: ReturnType<typeof createVerifiedBatchReceipt> }) => void;
            discard: () => void;
        } | void;
        /** Observe the exact durable receipt and revision after the final project checkpoint becomes visible. */
        onProjectCommitFinalized?: (result: {
            receipt: ReturnType<typeof createVerifiedBatchReceipt>;
            revision: string;
        }) => void;
        /** Observe why exact post-checkpoint evidence could not be provided after a durable project commit. */
        onProjectCommitFinalizationUnavailable?: (result: { reason: string }) => void;
        /** Refuse final checkpoint evidence when the caller's project-write authority was invalidated. */
        shouldFinalizeProjectCommit?: () => boolean;
        /** Observe the storage commit before deferred post-commit effects begin. */
        onCommitted?: (actions: readonly AppAction[]) => void;
    };
    onProjectCommitPrepared?: () => void;
};

type ProjectCommitRecoveryPreparation = Exclude<
    ReturnType<
        NonNullable<NonNullable<ExecuteVersionedCommandBatchEnvelopeInput['options']>['onProjectCommitCheckpoint']>
    >,
    void
>;

const PROJECT_COMMIT_RECOVERY_WARNING =
    'The atomic project commit is durable, but post-commit receipt finalization was interrupted.';
const PROJECT_RECEIPT_REVISION_WARNING =
    'Resulting project heads are omitted because the verified receipt is itself journaled in project truth.';
const PROJECT_EFFECT_RECOVERY_REQUIRES_EXACT_CHECKPOINT_REVISION =
    'Pending project checkpoint recovery requires exact post-commit project revision evidence.';
const activeIdempotencyClaims = new Set<string>();

function getStorageCommitRevisionFailureMessage(error: Error | null): string {
    return error?.message ?? 'exact storage-commit revision evidence is unavailable';
}

function reportUnavailableProjectCommitFinalization(
    options: ExecuteVersionedCommandBatchEnvelopeInput['options'],
    error: unknown
): void {
    const reason = error instanceof Error ? error.message : String(error);
    try {
        options?.onProjectCommitFinalizationUnavailable?.({ reason });
    } catch {
        // Finalization observers never alter the durable command result.
    }
}

function settlePreparedProjectCommitRecovery(input: {
    preparation: ProjectCommitRecoveryPreparation | null;
    envelope: Parameters<typeof getProjectCommandBatchIdempotencyCheckpoint>[0] & {
        baseRevision: string;
        batchId: string;
        commands: Parameters<typeof parseStoredVerifiedBatchReceipt>[0]['commands'];
        runId: string;
    };
}): void {
    if (!input.preparation) {
        return;
    }
    let checkpoint: ReturnType<typeof getProjectCommandBatchIdempotencyCheckpoint>;
    try {
        checkpoint = getProjectCommandBatchIdempotencyCheckpoint(input.envelope);
    } catch {
        // Without project truth, keep the prepared capsule so restart recovery can decide safely.
        return;
    }
    if (checkpoint.status === 'pending') {
        const receipt = parseStoredVerifiedBatchReceipt({
            baseRevision: input.envelope.baseRevision,
            batchId: input.envelope.batchId,
            commands: input.envelope.commands,
            contentHash: input.envelope.contentHash,
            runId: input.envelope.runId,
            serializedReceipt: checkpoint.serializedReceipt,
        });
        if (receipt?.pendingEffects.length) {
            try {
                input.preparation.promote({ receipt });
            } catch {
                // The prepared capsule remains durable and can be promoted from the project checkpoint after restart.
            }
            return;
        }
    }
    try {
        input.preparation.discard();
    } catch {
        // A stale prepared capsule is rejected against project truth before recovery and pruned on restart.
    }
}

export async function executeVersionedCommandBatchEnvelope(input: ExecuteVersionedCommandBatchEnvelopeInput) {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'rejected' as const, reason: parsed.reason, actions: [] as [] };
    }
    const resolvedCommands = resolveVersionedCommandBatchBindings(parsed.envelope);
    const resolvedEnvelope = { ...parsed.envelope, commands: resolvedCommands };
    if (parsed.envelope.mode === 'preview') {
        return previewVersionedCommandBatchEnvelope(resolvedEnvelope);
    }
    const batchContentHash = await getCommandBatchContentHash(parsed.envelope);
    const requiresDurableExecutionAuthority = commandBatchIdempotencyPort.isConfigured();
    let observedBaseRevision: string | null = null;
    const receiptWarnings: string[] = [];
    try {
        if (commandProjectRevisionPort.isConfigured()) {
            observedBaseRevision = commandProjectRevisionPort.capture();
        } else {
            receiptWarnings.push('Observed base revision is unavailable: revision provider is not configured');
        }
    } catch (error) {
        receiptWarnings.push(
            `Observed base revision could not be captured: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    const idempotencyContentHash = requiresDurableExecutionAuthority ? batchContentHash : null;
    let mayReclaimPendingClaim = false;
    const projectCommitRecovery: {
        receipt: ReturnType<typeof createVerifiedBatchReceipt> | null;
        preparation: ProjectCommitRecoveryPreparation | null;
    } = {
        preparation: null,
        receipt: null,
    };
    if (requiresDurableExecutionAuthority) {
        if (!commandBatchExecutionAuthorityPort.canExecute()) {
            const result = {
                status: 'rejected' as const,
                reason: 'Only the authoritative collaboration host can execute a durable command batch',
                actions: [] as [],
            };
            return {
                ...result,
                receipt: createVerifiedBatchReceipt({
                    contentHash: batchContentHash,
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings,
                    resultingRevision: observedBaseRevision,
                    result,
                }),
            };
        }
        try {
            const activeClaimId = `${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`;
            const projectCheckpoint = activeIdempotencyClaims.has(activeClaimId)
                ? { status: 'missing' as const }
                : getProjectCommandBatchIdempotencyCheckpoint({
                      projectId: parsed.envelope.projectId,
                      idempotencyKey: parsed.envelope.idempotencyKey,
                      contentHash: batchContentHash,
                  });
            if (projectCheckpoint.status === 'unsupported-schema') {
                const result = {
                    status: 'rejected' as const,
                    reason: 'Project idempotency ledger schema is unsupported',
                    actions: [] as [],
                };
                return {
                    ...result,
                    receipt: createVerifiedBatchReceipt({
                        contentHash: batchContentHash,
                        envelope: resolvedEnvelope,
                        observedBaseRevision,
                        receiptWarnings,
                        resultingRevision: observedBaseRevision,
                        result,
                    }),
                };
            }
            if (projectCheckpoint.status === 'conflict') {
                const result = {
                    status: 'rejected' as const,
                    reason: 'Idempotency key was already used for different batch content',
                    actions: [] as [],
                };
                return {
                    ...result,
                    receipt: createVerifiedBatchReceipt({
                        contentHash: batchContentHash,
                        envelope: resolvedEnvelope,
                        observedBaseRevision,
                        receiptWarnings,
                        resultingRevision: observedBaseRevision,
                        result,
                    }),
                };
            }
            if (projectCheckpoint.status === 'complete') {
                const receipt = parseStoredVerifiedBatchReceipt({
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
                    contentHash: batchContentHash,
                    runId: parsed.envelope.runId,
                    serializedReceipt: projectCheckpoint.serializedReceipt,
                });
                if (!receipt) {
                    return {
                        status: 'rejected' as const,
                        reason: 'Stored project idempotency receipt is invalid',
                        actions: [] as [],
                    };
                }
                return { status: 'idempotent-replay' as const, actions: [] as [], receipt };
            }
            if (projectCheckpoint.status === 'pending') {
                const receipt = parseStoredVerifiedBatchReceipt({
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
                    contentHash: batchContentHash,
                    runId: parsed.envelope.runId,
                    serializedReceipt: projectCheckpoint.serializedReceipt,
                });
                if (!receipt) {
                    return {
                        status: 'rejected' as const,
                        reason: 'Stored project idempotency receipt is invalid',
                        actions: [] as [],
                    };
                }
                const recoveryLeaseAcquired = await commandBatchIdempotencyPort.tryAcquireRecoveryLease({
                    projectId: parsed.envelope.projectId,
                    idempotencyKey: parsed.envelope.idempotencyKey,
                    contentHash: batchContentHash,
                });
                if (recoveryLeaseAcquired !== true) {
                    return {
                        status: 'ambiguous' as const,
                        reason: 'Command batch external-effect recovery is already in progress',
                        actions: [] as [],
                        receipt,
                    };
                }
                try {
                    const recoveryCheckpoint = getProjectCommandBatchIdempotencyCheckpoint({
                        projectId: parsed.envelope.projectId,
                        idempotencyKey: parsed.envelope.idempotencyKey,
                        contentHash: batchContentHash,
                    });
                    if (recoveryCheckpoint.status === 'complete') {
                        const completedReceipt = parseStoredVerifiedBatchReceipt({
                            baseRevision: parsed.envelope.baseRevision,
                            batchId: parsed.envelope.batchId,
                            commands: parsed.envelope.commands,
                            contentHash: batchContentHash,
                            runId: parsed.envelope.runId,
                            serializedReceipt: recoveryCheckpoint.serializedReceipt,
                        });
                        if (!completedReceipt) {
                            return {
                                status: 'rejected' as const,
                                reason: 'Stored project idempotency receipt is invalid',
                                actions: [] as [],
                            };
                        }
                        return { status: 'idempotent-replay' as const, actions: [] as [], receipt: completedReceipt };
                    }
                    if (recoveryCheckpoint.status === 'unsupported-schema') {
                        return {
                            status: 'rejected' as const,
                            reason: 'Project idempotency ledger schema is unsupported',
                            actions: [] as [],
                        };
                    }
                    if (recoveryCheckpoint.status === 'conflict') {
                        return {
                            status: 'rejected' as const,
                            reason: 'Idempotency key was already used for different batch content',
                            actions: [] as [],
                        };
                    }
                    if (recoveryCheckpoint.status === 'missing') {
                        return {
                            status: 'ambiguous' as const,
                            reason: 'Project idempotency checkpoint disappeared during external-effect recovery',
                            actions: [] as [],
                            receipt,
                        };
                    }
                    const recoveryReceipt = parseStoredVerifiedBatchReceipt({
                        baseRevision: parsed.envelope.baseRevision,
                        batchId: parsed.envelope.batchId,
                        commands: parsed.envelope.commands,
                        contentHash: batchContentHash,
                        runId: parsed.envelope.runId,
                        serializedReceipt: recoveryCheckpoint.serializedReceipt,
                    });
                    if (!recoveryReceipt) {
                        return {
                            status: 'rejected' as const,
                            reason: 'Stored project idempotency receipt is invalid',
                            actions: [] as [],
                        };
                    }
                    return {
                        status: 'ambiguous' as const,
                        actions: [] as [],
                        reason: PROJECT_EFFECT_RECOVERY_REQUIRES_EXACT_CHECKPOINT_REVISION,
                        receipt: recoveryReceipt,
                    };
                } finally {
                    try {
                        await commandBatchIdempotencyPort.release({
                            projectId: parsed.envelope.projectId,
                            idempotencyKey: parsed.envelope.idempotencyKey,
                            contentHash: batchContentHash,
                        });
                    } catch {
                        // The recovery outcome remains authoritative; repository release is best effort.
                    }
                }
            }
            mayReclaimPendingClaim = true;
            const prior = await commandBatchIdempotencyPort.lookup({
                projectId: parsed.envelope.projectId,
                idempotencyKey: parsed.envelope.idempotencyKey,
                contentHash: batchContentHash,
            });
            if (prior?.status === 'complete') {
                const receipt = parseStoredVerifiedBatchReceipt({
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
                    contentHash: batchContentHash,
                    runId: parsed.envelope.runId,
                    serializedReceipt: prior.serializedReceipt,
                });
                if (!receipt) {
                    return {
                        status: 'rejected' as const,
                        reason: 'Stored idempotency receipt is invalid',
                        actions: [] as [],
                    };
                }
                return { status: 'idempotent-replay' as const, actions: [] as [], receipt };
            }
        } catch (error) {
            const result = {
                status: 'rejected' as const,
                reason: `Command batch idempotency admission failed: ${error instanceof Error ? error.message : String(error)}`,
                actions: [] as [],
            };
            return {
                ...result,
                receipt: createVerifiedBatchReceipt({
                    contentHash: batchContentHash,
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings,
                    resultingRevision: observedBaseRevision,
                    result,
                }),
            };
        }
    }
    if (!input.approvalBinding) {
        const result = {
            status: 'rejected' as const,
            reason: 'Commit batch requires an exact approval binding',
            actions: [] as [],
        };
        return {
            ...result,
            receipt: createVerifiedBatchReceipt({
                contentHash: batchContentHash,
                envelope: resolvedEnvelope,
                observedBaseRevision,
                receiptWarnings,
                resultingRevision: observedBaseRevision,
                result,
            }),
        };
    }
    if (idempotencyContentHash !== null) {
        try {
            const claim = await commandBatchIdempotencyPort.claim({
                projectId: parsed.envelope.projectId,
                idempotencyKey: parsed.envelope.idempotencyKey,
                contentHash: idempotencyContentHash,
                reclaimPending: mayReclaimPendingClaim,
            });
            if (claim?.status === 'complete') {
                const receipt = parseStoredVerifiedBatchReceipt({
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
                    contentHash: batchContentHash,
                    runId: parsed.envelope.runId,
                    serializedReceipt: claim.serializedReceipt,
                });
                if (!receipt) {
                    return {
                        status: 'rejected' as const,
                        reason: 'Stored idempotency receipt is invalid',
                        actions: [] as [],
                    };
                }
                return { status: 'idempotent-replay' as const, actions: [] as [], receipt };
            }
            if (claim?.status === 'conflict') {
                const result = {
                    status: 'rejected' as const,
                    reason: 'Idempotency key was already used for different batch content',
                    actions: [] as [],
                };
                return {
                    ...result,
                    receipt: createVerifiedBatchReceipt({
                        contentHash: batchContentHash,
                        envelope: resolvedEnvelope,
                        observedBaseRevision,
                        receiptWarnings,
                        resultingRevision: observedBaseRevision,
                        result,
                    }),
                };
            }
            if (claim?.status === 'pending') {
                const result = {
                    status: 'ambiguous' as const,
                    reason: 'An identical command batch is already in progress',
                    actions: [] as [],
                };
                return {
                    ...result,
                    receipt: createVerifiedBatchReceipt({
                        contentHash: batchContentHash,
                        envelope: resolvedEnvelope,
                        observedBaseRevision,
                        receiptWarnings,
                        resultingRevision: observedBaseRevision,
                        result,
                    }),
                };
            }
            activeIdempotencyClaims.add(`${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`);
        } catch (error) {
            const result = {
                status: 'rejected' as const,
                reason: `Command batch idempotency admission failed: ${error instanceof Error ? error.message : String(error)}`,
                actions: [] as [],
            };
            return {
                ...result,
                receipt: createVerifiedBatchReceipt({
                    contentHash: batchContentHash,
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings,
                    resultingRevision: observedBaseRevision,
                    result,
                }),
            };
        }
    }
    let result: Awaited<ReturnType<typeof executeVersionedCommandBatch>>;
    const callerShouldExecute = input.options?.shouldExecute;
    const callerOnCommitted = input.options?.onCommitted;
    let exactStorageCommitRevision: string | undefined;
    let storageCommitRevisionError: Error | null = null;
    let exactProjectCheckpointRevision: string | undefined;
    let projectCheckpointRevisionError: Error | null = null;
    try {
        result = await executeVersionedCommandBatch({
            commands: resolvedCommands.map((command) =>
                serializeVersionedCommandEnvelope({ ...command, groupId: parsed.envelope.batchId })
            ),
            divergenceTargetIds: getVersionedCommandBatchDivergenceTargetIds(resolvedEnvelope),
            normalizedProjectRevision: parsed.envelope.baseRevision,
            options: {
                ...input.options,
                authorizeFirstHandler: () => {
                    const approval = consumeCommandApprovalBinding({
                        approvalBinding: input.approvalBinding!,
                        authority: input.authority,
                        serialized: input.serialized,
                    });
                    return approval.status === 'invalid' ? approval.reason : null;
                },
                groupId: parsed.envelope.batchId,
                shouldExecute: () =>
                    (!requiresDurableExecutionAuthority || commandBatchExecutionAuthorityPort.canExecute()) &&
                    (callerShouldExecute?.() ?? true),
                onCommitted: (actions) => {
                    try {
                        if (!commandProjectRevisionPort.isConfigured()) {
                            throw new Error('The project revision provider is unavailable at the storage commit.');
                        }
                        exactStorageCommitRevision = commandProjectRevisionPort.capture();
                    } catch (error) {
                        storageCommitRevisionError =
                            error instanceof Error
                                ? error
                                : new Error('Unknown storage-commit revision capture failure.');
                    }
                    callerOnCommitted?.(actions);
                },
                onProjectCommitPrepared: (committedResult) => {
                    if (idempotencyContentHash !== null) {
                        const recoveryResult = {
                            status: 'committed-with-warning' as const,
                            actions: committedResult.actions,
                            warning: PROJECT_COMMIT_RECOVERY_WARNING,
                            warningDetails: [
                                { kind: 'observer' as const, message: PROJECT_COMMIT_RECOVERY_WARNING },
                                ...committedResult.pendingEffects.map((pendingEffect) => ({
                                    kind: 'external-effect' as const,
                                    commandId: pendingEffect.commandId,
                                    message: pendingEffect.reason,
                                    pendingEffect,
                                })),
                            ],
                        };
                        projectCommitRecovery.receipt = createVerifiedBatchReceipt({
                            contentHash: batchContentHash,
                            envelope: resolvedEnvelope,
                            observedBaseRevision,
                            receiptWarnings: [...receiptWarnings, PROJECT_RECEIPT_REVISION_WARNING],
                            resultingRevision: null,
                            result: recoveryResult,
                        });
                        recordProjectCommandBatchIdempotencyCheckpoint({
                            projectId: parsed.envelope.projectId,
                            idempotencyKey: parsed.envelope.idempotencyKey,
                            contentHash: idempotencyContentHash,
                            state: 'effects-pending',
                            serializedReceipt: JSON.stringify(projectCommitRecovery.receipt),
                        });
                        projectCommitRecovery.preparation =
                            input.options?.onProjectCommitCheckpoint?.({ receipt: projectCommitRecovery.receipt }) ??
                            null;
                    }
                    input.onProjectCommitPrepared?.();
                },
                prepareValidation: ({ allowCompatibleProjectDivergence }) =>
                    prepareCommandBatchPreflight(resolvedEnvelope, { allowCompatibleProjectDivergence }),
                requireCompensation: true,
            },
        });
    } catch (error) {
        if (idempotencyContentHash !== null) {
            settlePreparedProjectCommitRecovery({
                preparation: projectCommitRecovery.preparation,
                envelope: {
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
                    contentHash: idempotencyContentHash,
                    idempotencyKey: parsed.envelope.idempotencyKey,
                    projectId: parsed.envelope.projectId,
                    runId: parsed.envelope.runId,
                },
            });
        }
        if (idempotencyContentHash !== null) {
            await commandBatchIdempotencyPort.release({
                projectId: parsed.envelope.projectId,
                idempotencyKey: parsed.envelope.idempotencyKey,
                contentHash: idempotencyContentHash,
            });
        }
        activeIdempotencyClaims.delete(`${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`);
        throw error;
    }
    let resultingRevision: string | null = null;
    if (result.status === 'committed' || result.status === 'committed-with-warning') {
        resultingRevision = exactStorageCommitRevision ?? null;
        if (resultingRevision === null) {
            if (!commandProjectRevisionPort.isConfigured()) {
                receiptWarnings.push('Resulting project revision is unavailable: revision provider is not configured');
            } else {
                const reason = getStorageCommitRevisionFailureMessage(storageCommitRevisionError);
                receiptWarnings.push(`Resulting project revision could not be captured: ${reason}`);
            }
        }
    } else {
        try {
            if (commandProjectRevisionPort.isConfigured()) {
                resultingRevision = commandProjectRevisionPort.capture();
            } else {
                receiptWarnings.push('Resulting project revision is unavailable: revision provider is not configured');
            }
        } catch (error) {
            receiptWarnings.push(
                `Resulting project revision could not be captured: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    let finalized = {
        ...result,
        receipt: createVerifiedBatchReceipt({
            contentHash: batchContentHash,
            envelope: resolvedEnvelope,
            observedBaseRevision,
            receiptWarnings,
            resultingRevision,
            result,
        }),
    };
    if (idempotencyContentHash !== null) {
        if (result.status === 'committed' || result.status === 'committed-with-warning') {
            let finalizationEvidenceError: unknown = null;
            let finalProjectReceipt: ReturnType<typeof createVerifiedBatchReceipt> | null = null;
            let projectCheckpointPersistenceError: unknown = null;
            try {
                if (input.options?.shouldFinalizeProjectCommit?.() === false) {
                    finalizationEvidenceError = new Error(
                        'The project changed outside the confirmed command before finalization evidence was recorded.'
                    );
                }
            } catch (error) {
                finalizationEvidenceError = error;
            }
            try {
                const hasPendingExternalEffect =
                    result.status === 'committed-with-warning' &&
                    result.warningDetails?.some(({ kind }) => kind === 'external-effect') === true;
                const projectReceipt = createVerifiedBatchReceipt({
                    contentHash: batchContentHash,
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings: [...receiptWarnings, PROJECT_RECEIPT_REVISION_WARNING],
                    resultingRevision: null,
                    result,
                });
                persistProjectCommandBatchIdempotencyCheckpoint({
                    projectId: parsed.envelope.projectId,
                    idempotencyKey: parsed.envelope.idempotencyKey,
                    contentHash: idempotencyContentHash,
                    state: hasPendingExternalEffect ? 'effects-pending' : 'complete',
                    serializedReceipt: JSON.stringify(projectReceipt),
                });
                try {
                    if (!commandProjectRevisionPort.isConfigured()) {
                        throw new Error('The project revision provider is unavailable at the durable checkpoint.');
                    }
                    exactProjectCheckpointRevision = commandProjectRevisionPort.capture();
                } catch (error) {
                    projectCheckpointRevisionError =
                        error instanceof Error
                            ? error
                            : new Error('Unknown durable-checkpoint revision capture failure.');
                }
                finalProjectReceipt = projectReceipt;
                finalized = { ...finalized, receipt: projectReceipt };
            } catch (error) {
                projectCheckpointPersistenceError = error;
                if (projectCommitRecovery.receipt) {
                    finalized = {
                        status: 'committed-with-warning' as const,
                        actions: result.actions,
                        warning: PROJECT_COMMIT_RECOVERY_WARNING,
                        warningDetails: [{ kind: 'observer' as const, message: PROJECT_COMMIT_RECOVERY_WARNING }],
                        receipt: projectCommitRecovery.receipt,
                    };
                }
            }
            if (finalizationEvidenceError !== null) {
                reportUnavailableProjectCommitFinalization(input.options, finalizationEvidenceError);
            } else if (projectCheckpointPersistenceError !== null || finalProjectReceipt === null) {
                reportUnavailableProjectCommitFinalization(
                    input.options,
                    projectCheckpointPersistenceError ??
                        new Error('The durable project checkpoint could not be persisted for finalization evidence.')
                );
            } else {
                try {
                    const checkpoint = getProjectCommandBatchIdempotencyCheckpoint({
                        projectId: parsed.envelope.projectId,
                        idempotencyKey: parsed.envelope.idempotencyKey,
                        contentHash: idempotencyContentHash,
                    });
                    if (checkpoint.status !== 'complete' && checkpoint.status !== 'pending') {
                        throw new Error('The durable project checkpoint is unavailable for finalization evidence.');
                    }
                    const serializedFinalReceipt = JSON.stringify(finalProjectReceipt);
                    if (checkpoint.serializedReceipt !== serializedFinalReceipt) {
                        throw new Error('The durable project checkpoint does not contain the exact finalized receipt.');
                    }
                    const durableFinalReceipt = parseStoredVerifiedBatchReceipt({
                        baseRevision: parsed.envelope.baseRevision,
                        batchId: parsed.envelope.batchId,
                        commands: parsed.envelope.commands,
                        contentHash: idempotencyContentHash,
                        runId: parsed.envelope.runId,
                        serializedReceipt: checkpoint.serializedReceipt,
                    });
                    if (!durableFinalReceipt) {
                        throw new Error('The durable project checkpoint receipt is invalid for finalization evidence.');
                    }
                    if (exactProjectCheckpointRevision === undefined) {
                        throw (
                            projectCheckpointRevisionError ??
                            new Error('The exact durable-checkpoint revision is unavailable.')
                        );
                    }
                    input.options?.onProjectCommitFinalized?.({
                        receipt: durableFinalReceipt,
                        revision: exactProjectCheckpointRevision,
                    });
                } catch (error) {
                    reportUnavailableProjectCommitFinalization(input.options, error);
                }
            }
        }
        settlePreparedProjectCommitRecovery({
            preparation: projectCommitRecovery.preparation,
            envelope: {
                baseRevision: parsed.envelope.baseRevision,
                batchId: parsed.envelope.batchId,
                commands: parsed.envelope.commands,
                contentHash: idempotencyContentHash,
                idempotencyKey: parsed.envelope.idempotencyKey,
                projectId: parsed.envelope.projectId,
                runId: parsed.envelope.runId,
            },
        });
        try {
            await commandBatchIdempotencyPort.complete({
                projectId: parsed.envelope.projectId,
                idempotencyKey: parsed.envelope.idempotencyKey,
                contentHash: idempotencyContentHash,
                serializedReceipt: JSON.stringify(finalized.receipt),
            });
        } catch (error) {
            activeIdempotencyClaims.delete(`${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`);
            if (result.status === 'committed' || result.status === 'committed-with-warning') {
                return finalized;
            }
            const warning = `Verified idempotency receipt could not be persisted: ${error instanceof Error ? error.message : String(error)}.`;
            return {
                ...finalized,
                receipt: createVerifiedBatchReceipt({
                    contentHash: batchContentHash,
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings: [...receiptWarnings, warning],
                    resultingRevision,
                    result,
                }),
            };
        }
    }
    activeIdempotencyClaims.delete(`${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`);
    return finalized;
}
