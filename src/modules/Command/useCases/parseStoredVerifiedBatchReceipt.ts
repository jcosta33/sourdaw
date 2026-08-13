import { type createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';

type StoredVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type StoredRevision = {
    normalizedRevision: string;
    documentIdentityEpoch: number | null;
    mutationEpoch: number | null;
    documents: unknown[];
};
type StoredCommandOutcome = {
    commandId: string;
    operation: string;
    outcome: 'committed' | 'executed' | 'no-op' | 'unknown' | 'not-applied';
    affectedIds: string[];
    compensationAvailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isRevision(value: unknown): value is StoredRevision {
    return (
        isRecord(value) &&
        typeof value.normalizedRevision === 'string' &&
        (value.documentIdentityEpoch === null || typeof value.documentIdentityEpoch === 'number') &&
        (value.mutationEpoch === null || typeof value.mutationEpoch === 'number') &&
        Array.isArray(value.documents) &&
        value.documents.every(
            (document) => isRecord(document) && typeof document.docId === 'string' && isStringArray(document.heads)
        )
    );
}

function isNullableRevision(value: unknown): boolean {
    return value === null || isRevision(value);
}

function isCommandOutcome(value: unknown): value is StoredCommandOutcome {
    return (
        isRecord(value) &&
        typeof value.commandId === 'string' &&
        typeof value.operation === 'string' &&
        (value.outcome === 'committed' ||
            value.outcome === 'executed' ||
            value.outcome === 'no-op' ||
            value.outcome === 'unknown' ||
            value.outcome === 'not-applied') &&
        isStringArray(value.affectedIds) &&
        typeof value.compensationAvailable === 'boolean'
    );
}

function isCreatedBinding(value: unknown): boolean {
    return (
        isRecord(value) &&
        typeof value.commandId === 'string' &&
        typeof value.argument === 'string' &&
        typeof value.value === 'string' &&
        (value.bindingId === undefined || typeof value.bindingId === 'string')
    );
}

function isArtifactLinks(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.render) &&
        value.render.every(
            (link) => isRecord(link) && typeof link.commandId === 'string' && typeof link.jobId === 'string'
        ) &&
        Array.isArray(value.analysis) &&
        value.analysis.every(
            (link) => isRecord(link) && typeof link.commandId === 'string' && typeof link.analysisId === 'string'
        )
    );
}

function isCompensation(value: unknown): boolean {
    return isRecord(value) && typeof value.available === 'boolean' && isStringArray(value.commandIds);
}

function isBatchOutcome(value: unknown): boolean {
    return (
        value === 'committed' ||
        value === 'committed-with-warning' ||
        value === 'executed' ||
        value === 'executed-with-warning' ||
        value === 'no-op' ||
        value === 'ambiguous' ||
        value === 'rejected' ||
        value === 'conflicted' ||
        value === 'cancelled' ||
        value === 'failed' ||
        value === 'partially-committed' ||
        value === 'verification-failed'
    );
}

export function parseStoredVerifiedBatchReceipt(input: {
    baseRevision: string;
    batchId: string;
    commands: ReadonlyArray<{ commandId: string; operation: string }>;
    runId: string;
    serializedReceipt: string;
}): StoredVerifiedBatchReceipt | null {
    let value: unknown;
    try {
        value = JSON.parse(input.serializedReceipt);
    } catch {
        return null;
    }
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        value.batchId !== input.batchId ||
        value.runId !== input.runId ||
        !isBatchOutcome(value.outcome) ||
        (value.atomicity !== 'atomic' && value.atomicity !== 'durable-atomic-with-non-atomic-effects') ||
        !isRevision(value.base) ||
        value.base.normalizedRevision !== input.baseRevision ||
        !isNullableRevision(value.observedBase) ||
        !isNullableRevision(value.resulting) ||
        !Array.isArray(value.commandOutcomes) ||
        value.commandOutcomes.length !== input.commands.length ||
        !value.commandOutcomes.every((command, index) => {
            const expected = input.commands[index];
            if (!expected || !isCommandOutcome(command)) {
                return false;
            }
            return command.commandId === expected.commandId && command.operation === expected.operation;
        }) ||
        !isStringArray(value.affectedIds) ||
        !Array.isArray(value.createdBindings) ||
        !value.createdBindings.every(isCreatedBinding) ||
        !isStringArray(value.warnings) ||
        !isStringArray(value.errors) ||
        !isArtifactLinks(value.links) ||
        !isCompensation(value.compensation) ||
        (value.semanticDiff !== null && !isRecord(value.semanticDiff)) ||
        typeof value.modelSummary !== 'string'
    ) {
        return null;
    }
    return value as StoredVerifiedBatchReceipt;
}
