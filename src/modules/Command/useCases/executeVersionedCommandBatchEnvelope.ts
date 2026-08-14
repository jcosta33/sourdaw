import { type ExecuteOptions } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createRecoveredVerifiedBatchReceipt } from './createRecoveredVerifiedBatchReceipt';
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
import { reconcileProjectCommandBatchEffects } from './reconcileProjectCommandBatchEffects';
import { recordProjectCommandBatchIdempotencyCheckpoint } from './recordProjectCommandBatchIdempotencyCheckpoint';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchEnvelopeInput = {
    authority: CommandBatchAuthority;
    confirmed?: boolean;
    serialized: string;
    options?: ExecuteOptions;
};

const PROJECT_COMMIT_RECOVERY_WARNING =
    'The atomic project commit is durable, but post-commit receipt finalization was interrupted.';
const PROJECT_RECEIPT_REVISION_WARNING =
    'Resulting project heads are omitted because the verified receipt is itself journaled in project truth.';
const activeIdempotencyClaims = new Set<string>();

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
    let idempotencyContentHash: string | null = null;
    let mayReclaimPendingClaim = false;
    const projectCommitRecovery: { receipt: ReturnType<typeof createVerifiedBatchReceipt> | null } = {
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
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings,
                    resultingRevision: observedBaseRevision,
                    result,
                }),
            };
        }
        try {
            idempotencyContentHash = await getCommandBatchContentHash(parsed.envelope);
            const activeClaimId = `${parsed.envelope.projectId}\u0000${parsed.envelope.idempotencyKey}`;
            const projectCheckpoint = activeIdempotencyClaims.has(activeClaimId)
                ? { status: 'missing' as const }
                : getProjectCommandBatchIdempotencyCheckpoint({
                      projectId: parsed.envelope.projectId,
                      idempotencyKey: parsed.envelope.idempotencyKey,
                      contentHash: idempotencyContentHash,
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
                    contentHash: idempotencyContentHash,
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
                        contentHash: idempotencyContentHash,
                    });
                    if (recoveryCheckpoint.status === 'complete') {
                        const completedReceipt = parseStoredVerifiedBatchReceipt({
                            baseRevision: parsed.envelope.baseRevision,
                            batchId: parsed.envelope.batchId,
                            commands: parsed.envelope.commands,
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
                    const reconciliation = await reconcileProjectCommandBatchEffects({
                        envelope: resolvedEnvelope,
                        serializedReceipt: recoveryCheckpoint.serializedReceipt,
                        shouldReconcile: () => commandBatchExecutionAuthorityPort.canExecute(),
                    });
                    if (reconciliation.status === 'failed') {
                        return {
                            status: 'ambiguous' as const,
                            reason: reconciliation.reason,
                            actions: [] as [],
                            receipt: recoveryReceipt,
                        };
                    }
                    if (!commandBatchExecutionAuthorityPort.canExecute()) {
                        return {
                            status: 'ambiguous' as const,
                            reason: 'Only the authoritative collaboration host can reconcile a durable command batch',
                            actions: [] as [],
                            receipt: recoveryReceipt,
                        };
                    }
                    const recoveredReceipt = createRecoveredVerifiedBatchReceipt({
                        envelope: resolvedEnvelope,
                        priorReceipt: recoveryReceipt,
                        receiptWarnings: [PROJECT_RECEIPT_REVISION_WARNING],
                    });
                    const serializedRecoveredReceipt = JSON.stringify(recoveredReceipt);
                    try {
                        persistProjectCommandBatchIdempotencyCheckpoint({
                            projectId: parsed.envelope.projectId,
                            idempotencyKey: parsed.envelope.idempotencyKey,
                            contentHash: idempotencyContentHash,
                            state: 'complete',
                            serializedReceipt: serializedRecoveredReceipt,
                        });
                    } catch (error) {
                        return {
                            status: 'ambiguous' as const,
                            reason: `Idempotency checkpoint finalization failed: ${error instanceof Error ? error.message : String(error)}`,
                            actions: [] as [],
                            receipt: recoveryReceipt,
                        };
                    }
                    try {
                        await commandBatchIdempotencyPort.complete({
                            projectId: parsed.envelope.projectId,
                            idempotencyKey: parsed.envelope.idempotencyKey,
                            contentHash: idempotencyContentHash,
                            serializedReceipt: serializedRecoveredReceipt,
                        });
                    } catch {
                        // Project truth is the durable authority; the local cache may heal on a later retry.
                    }
                    return {
                        status: 'idempotent-replay' as const,
                        actions: [] as [],
                        receipt: recoveredReceipt,
                        recoveredExternalEffects: true as const,
                    };
                } finally {
                    try {
                        await commandBatchIdempotencyPort.release({
                            projectId: parsed.envelope.projectId,
                            idempotencyKey: parsed.envelope.idempotencyKey,
                            contentHash: idempotencyContentHash,
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
                contentHash: idempotencyContentHash,
            });
            if (prior?.status === 'complete') {
                const receipt = parseStoredVerifiedBatchReceipt({
                    baseRevision: parsed.envelope.baseRevision,
                    batchId: parsed.envelope.batchId,
                    commands: parsed.envelope.commands,
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
                    envelope: resolvedEnvelope,
                    observedBaseRevision,
                    receiptWarnings,
                    resultingRevision: observedBaseRevision,
                    result,
                }),
            };
        }
    }
    if (!input.confirmed && !parsed.envelope.grants.autoCommit) {
        const result = {
            status: 'rejected' as const,
            reason: 'Commit batch requires confirmation or the auto-commit grant',
            actions: [] as [],
        };
        return {
            ...result,
            receipt: createVerifiedBatchReceipt({
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
    try {
        result = await executeVersionedCommandBatch({
            commands: resolvedCommands.map((command) =>
                serializeVersionedCommandEnvelope({ ...command, groupId: parsed.envelope.batchId })
            ),
            divergenceTargetIds: getVersionedCommandBatchDivergenceTargetIds(resolvedEnvelope),
            normalizedProjectRevision: parsed.envelope.baseRevision,
            options: {
                ...input.options,
                groupId: parsed.envelope.batchId,
                shouldExecute: () =>
                    (!requiresDurableExecutionAuthority || commandBatchExecutionAuthorityPort.canExecute()) &&
                    (callerShouldExecute?.() ?? true),
                onProjectCommitPrepared: (committedResult) => {
                    if (idempotencyContentHash === null) {
                        return;
                    }
                    const recoveryResult = {
                        status: 'committed-with-warning' as const,
                        actions: committedResult.actions,
                        warning: PROJECT_COMMIT_RECOVERY_WARNING,
                        warningDetails: [{ kind: 'observer' as const, message: PROJECT_COMMIT_RECOVERY_WARNING }],
                    };
                    projectCommitRecovery.receipt = createVerifiedBatchReceipt({
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
                },
                prepareValidation: ({ allowCompatibleProjectDivergence }) =>
                    prepareCommandBatchPreflight(resolvedEnvelope, { allowCompatibleProjectDivergence }),
                requireCompensation: true,
            },
        });
    } catch (error) {
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
    let finalized = {
        ...result,
        receipt: createVerifiedBatchReceipt({
            envelope: resolvedEnvelope,
            observedBaseRevision,
            receiptWarnings,
            resultingRevision,
            result,
        }),
    };
    if (idempotencyContentHash !== null) {
        if (result.status === 'committed' || result.status === 'committed-with-warning') {
            try {
                const hasPendingExternalEffect =
                    result.status === 'committed-with-warning' &&
                    result.warningDetails?.some(({ kind }) => kind === 'external-effect') === true;
                const projectReceipt = createVerifiedBatchReceipt({
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
                finalized = { ...finalized, receipt: projectReceipt };
            } catch {
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
        }
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
