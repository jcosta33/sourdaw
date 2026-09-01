import { describe, expect, it } from 'vitest';

import { parseStoredVerifiedBatchReceipt } from '../parseStoredVerifiedBatchReceipt';

const CONTENT_HASH = `sha256:${'a'.repeat(64)}`;
const COMMAND = { commandId: 'command-1', operation: 'renderProjectSections' };
const REVISION = {
    normalizedRevision: 'revision-1',
    documentIdentityEpoch: null,
    mutationEpoch: null,
    documents: [],
};

function storedReceipt(pendingEffect: Record<string, unknown>): string {
    return JSON.stringify({
        schemaVersion: 2,
        contentHash: CONTENT_HASH,
        runId: 'run-1',
        batchId: 'batch-1',
        outcome: 'partially-committed',
        atomicity: 'durable-atomic-with-non-atomic-effects',
        base: REVISION,
        observedBase: REVISION,
        resulting: REVISION,
        commandOutcomes: [
            {
                ...COMMAND,
                outcome: 'committed',
                affectedIds: [],
                compensationAvailable: false,
            },
        ],
        affectedIds: [],
        createdBindings: [],
        warnings: [],
        errors: [],
        pendingEffects: [pendingEffect],
        links: { render: [], analysis: [] },
        compensation: { available: false, commandIds: [] },
        semanticDiff: null,
        modelSummary: 'The project commit succeeded, but a follow-up effect is pending.',
    });
}

function parseReceipt(pendingEffect: Record<string, unknown>) {
    return parseStoredVerifiedBatchReceipt({
        baseRevision: REVISION.normalizedRevision,
        batchId: 'batch-1',
        commands: [COMMAND],
        contentHash: CONTENT_HASH,
        runId: 'run-1',
        serializedReceipt: storedReceipt(pendingEffect),
    });
}

describe('parseStoredVerifiedBatchReceipt', () => {
    it('round-trips an external retention-capacity effect', () => {
        const pendingEffect = {
            ...COMMAND,
            kind: 'external-effect',
            reason: 'The retained render cannot fit the session artifact budget.',
            remediation: 'manual-repair',
            state: 'pending',
            failureKind: 'retention-capacity',
        };

        expect(parseReceipt(pendingEffect)).toMatchObject({ pendingEffects: [pendingEffect] });
    });

    it('rejects a runtime-graph effect carrying a failure kind', () => {
        expect(
            parseReceipt({
                ...COMMAND,
                kind: 'runtime-graph',
                reason: 'The runtime graph needs repair.',
                remediation: 'repair',
                state: 'pending',
                failureKind: 'retention-capacity',
            })
        ).toBeNull();
    });
});
