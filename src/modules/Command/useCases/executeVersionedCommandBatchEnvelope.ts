import { type ExecuteOptions } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
import { executeVersionedCommandBatch } from './executeVersionedCommandBatch';
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
    let observedBaseRevision = resolvedEnvelope.baseRevision;
    try {
        if (commandProjectRevisionPort.isConfigured()) {
            observedBaseRevision = commandProjectRevisionPort.capture();
        }
    } catch {
        // Execution performs the authoritative validation and will return its
        // own failure; the receipt retains the approved base if observation fails.
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
                resultingRevision: observedBaseRevision,
                result,
            }),
        };
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
    const receiptWarnings: string[] = [];
    try {
        if (commandProjectRevisionPort.isConfigured()) {
            resultingRevision = commandProjectRevisionPort.capture();
        } else {
            resultingRevision = observedBaseRevision;
        }
    } catch (error) {
        receiptWarnings.push(
            `Resulting project revision could not be captured: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    return {
        ...result,
        receipt: createVerifiedBatchReceipt({
            envelope: resolvedEnvelope,
            observedBaseRevision,
            receiptWarnings,
            resultingRevision,
            result,
        }),
    };
}
