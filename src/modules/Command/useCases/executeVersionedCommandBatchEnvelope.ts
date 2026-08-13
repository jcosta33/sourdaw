import { type ExecuteOptions } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
import { executeVersionedCommandBatch } from './executeVersionedCommandBatch';
import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';
import { previewVersionedCommandBatchEnvelope } from './previewVersionedCommandBatchEnvelope';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchEnvelopeInput = {
    authority: CommandBatchAuthority;
    confirmed?: boolean;
    serialized: string;
    options?: ExecuteOptions;
};

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
    if (commandBatchIdempotencyPort.isConfigured()) {
        try {
            idempotencyContentHash = await getCommandBatchContentHash(parsed.envelope);
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
    const result = await executeVersionedCommandBatch({
        commands: resolvedCommands.map((command) =>
            serializeVersionedCommandEnvelope({ ...command, groupId: parsed.envelope.batchId })
        ),
        normalizedProjectRevision: parsed.envelope.baseRevision,
        options: {
            ...input.options,
            groupId: parsed.envelope.batchId,
            prepareValidation: () => prepareCommandBatchPreflight(resolvedEnvelope),
            requireCompensation: true,
        },
    });
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
    const finalized = {
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
        try {
            await commandBatchIdempotencyPort.complete({
                projectId: parsed.envelope.projectId,
                idempotencyKey: parsed.envelope.idempotencyKey,
                contentHash: idempotencyContentHash,
                serializedReceipt: JSON.stringify(finalized.receipt),
            });
        } catch (error) {
            const warning = `Verified idempotency receipt could not be persisted: ${error instanceof Error ? error.message : String(error)}. Do not retry this batch.`;
            if (result.status === 'committed' || result.status === 'committed-with-warning') {
                const warningDetails = [
                    ...(result.status === 'committed-with-warning' ? (result.warningDetails ?? []) : []),
                    { kind: 'observer' as const, message: warning },
                ];
                const warnedResult = {
                    status: 'committed-with-warning' as const,
                    actions: result.actions,
                    warning: warningDetails.map(({ message }) => message).join('; '),
                    warningDetails,
                };
                return {
                    ...warnedResult,
                    receipt: createVerifiedBatchReceipt({
                        envelope: resolvedEnvelope,
                        observedBaseRevision,
                        receiptWarnings,
                        resultingRevision,
                        result: warnedResult,
                    }),
                };
            }
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
    return finalized;
}
