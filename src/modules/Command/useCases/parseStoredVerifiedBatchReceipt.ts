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
type StoredPendingEffectBase = {
    commandId: string;
    operation: string;
    reason: string;
    state: 'pending';
};
type StoredPendingEffect = StoredPendingEffectBase &
    (
        | { kind: 'runtime-graph'; remediation: 'retry' | 'repair' }
        | { kind: 'external-effect'; remediation: 'reconcile' | 'manual-repair' }
    );

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

function isPendingEffect(
    value: unknown,
    commands: ReadonlyArray<{ commandId: string; operation: string }>
): value is StoredPendingEffect {
    return (
        isRecord(value) &&
        typeof value.commandId === 'string' &&
        typeof value.operation === 'string' &&
        typeof value.reason === 'string' &&
        value.reason.trim().length > 0 &&
        ((value.kind === 'runtime-graph' && (value.remediation === 'retry' || value.remediation === 'repair')) ||
            (value.kind === 'external-effect' &&
                (value.remediation === 'reconcile' || value.remediation === 'manual-repair'))) &&
        value.state === 'pending' &&
        commands.some((command) => command.commandId === value.commandId && command.operation === value.operation)
    );
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

function hasConsistentBatchOutcome(value: Record<string, unknown>, pendingEffects: StoredPendingEffect[] | undefined) {
    if (!Array.isArray(value.commandOutcomes) || !value.commandOutcomes.every(isCommandOutcome)) {
        return false;
    }
    const commandOutcomes = value.commandOutcomes.map((command) => command.outcome);
    const hasCommittedCommand = commandOutcomes.some((outcome) => outcome === 'committed');
    const pendingEffectCount = pendingEffects?.length ?? 0;
    const allCommandOutcomes = (...expected: StoredCommandOutcome['outcome'][]) =>
        commandOutcomes.every((outcome) => expected.includes(outcome));

    if (value.outcome === 'committed') {
        return (
            value.atomicity === 'atomic' &&
            pendingEffectCount === 0 &&
            hasCommittedCommand &&
            allCommandOutcomes('committed', 'no-op')
        );
    }
    if (value.outcome === 'committed-with-warning') {
        return (
            value.atomicity === 'atomic' &&
            pendingEffectCount === 0 &&
            hasCommittedCommand &&
            allCommandOutcomes('committed', 'no-op')
        );
    }
    if (value.outcome === 'partially-committed') {
        return (
            value.atomicity === 'durable-atomic-with-non-atomic-effects' &&
            pendingEffectCount > 0 &&
            hasCommittedCommand &&
            allCommandOutcomes('committed', 'no-op')
        );
    }
    if (value.outcome === 'executed' || value.outcome === 'executed-with-warning') {
        return (
            value.atomicity === 'atomic' &&
            pendingEffectCount === 0 &&
            commandOutcomes.some((outcome) => outcome === 'executed') &&
            allCommandOutcomes('executed', 'no-op')
        );
    }
    if (value.outcome === 'no-op') {
        return value.atomicity === 'atomic' && pendingEffectCount === 0 && allCommandOutcomes('no-op');
    }
    if (value.outcome === 'ambiguous') {
        return value.atomicity === 'atomic' && pendingEffectCount === 0 && allCommandOutcomes('unknown');
    }
    return value.atomicity === 'atomic' && pendingEffectCount === 0 && allCommandOutcomes('not-applied');
}

export function parseStoredVerifiedBatchReceipt(input: {
    baseRevision: string;
    batchId: string;
    commands: ReadonlyArray<{ commandId: string; operation: string }>;
    contentHash: string;
    runId: string;
    serializedReceipt: string;
}): StoredVerifiedBatchReceipt | null {
    let value: unknown;
    try {
        value = JSON.parse(input.serializedReceipt);
    } catch {
        return null;
    }
    const pendingEffects = isRecord(value) && Array.isArray(value.pendingEffects) ? value.pendingEffects : undefined;
    if (
        !isRecord(value) ||
        value.schemaVersion !== 2 ||
        value.contentHash !== input.contentHash ||
        !/^sha256:[a-f0-9]{64}$/.test(input.contentHash) ||
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
        (value.outcome === 'partially-committed' &&
            (!pendingEffects ||
                pendingEffects.length === 0 ||
                value.atomicity !== 'durable-atomic-with-non-atomic-effects')) ||
        (value.pendingEffects !== undefined &&
            (!pendingEffects ||
                !pendingEffects.every((effect) => isPendingEffect(effect, input.commands)) ||
                new Set(pendingEffects.map((effect) => (isRecord(effect) ? effect.commandId : null))).size !==
                    pendingEffects.length ||
                (pendingEffects.length > 0 &&
                    (value.outcome !== 'partially-committed' ||
                        value.atomicity !== 'durable-atomic-with-non-atomic-effects')))) ||
        !hasConsistentBatchOutcome(value, pendingEffects) ||
        !isArtifactLinks(value.links) ||
        !isCompensation(value.compensation) ||
        (value.semanticDiff !== null && !isRecord(value.semanticDiff)) ||
        typeof value.modelSummary !== 'string'
    ) {
        return null;
    }
    return {
        ...value,
        pendingEffects: value.pendingEffects ?? [],
    } as StoredVerifiedBatchReceipt;
}
