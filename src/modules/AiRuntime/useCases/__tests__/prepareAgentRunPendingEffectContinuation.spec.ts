import { beforeEach, describe, expect, it } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    type createVerifiedBatchReceipt,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { MISSING_EXACT_CHECKPOINT_RECOVERY_REASON } from '../../models/GetPendingEffectRecoveryPolicy';
import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { prepareAgentRunPendingEffectContinuation } from '../prepareAgentRunPendingEffectContinuation';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;

const { clear: clearAgentRuns, create: createAgentRun, get: getAgentRun } = agentRunLifecycle;

const job: RenderProjectSectionJobSnapshot = {
    jobId: 'job-continuation-promotion',
    sectionId: 'section-continuation-promotion',
    sectionName: 'Continuation Promotion',
    startBeat: 0,
    endBeat: 8,
    sampleRate: 48_000,
    tailSeconds: 1,
};

function buildCommandBatch(input: { runId: string; batchId: string }) {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'renderProjectSections', payload: { sectionIds: [job.sectionId], jobs: [job] } },
        expectedEffect: 'Render a section as part of the batch under test.',
        normalizedProjectRevision: 'revision-continuation-base',
    });
    return compileVersionedCommandBatchEnvelope({
        runId: input.runId,
        batchId: input.batchId,
        projectId: 'project-continuation-promotion',
        baseRevision: 'revision-continuation-base',
        intent: 'Exercise prepared pending-effect continuation promotion.',
        commands: [serializeVersionedCommandEnvelope({ ...command, commandId: 'command-continuation-promotion' })],
    });
}

type FixturePendingEffect = {
    commandId: string;
    kind: 'external-effect';
    operation: string;
    reason: string;
    remediation: 'reconcile' | 'manual-repair';
    state: 'pending';
};

/**
 * `createVerifiedBatchReceipt`'s inferred type narrows `pendingEffects[].operation` to
 * `AppAction['type']`, but a receipt replayed from storage is validated and cast the same
 * way in `parseStoredVerifiedBatchReceipt` — a pending effect can name any operation string,
 * including one (like an event-bus publish) that is not itself a dispatchable command. The
 * cast below mirrors that production precedent for an otherwise fully-shaped fixture receipt.
 */
function buildReceipt(input: {
    runId: string;
    batchId: string;
    pendingEffects: readonly FixturePendingEffect[];
}): VerifiedBatchReceipt {
    return {
        schemaVersion: 2,
        contentHash: `sha256:${'0'.repeat(64)}`,
        runId: input.runId,
        batchId: input.batchId,
        outcome: 'partially-committed',
        atomicity: 'durable-atomic-with-non-atomic-effects',
        base: {
            normalizedRevision: 'revision-continuation-base',
            documentIdentityEpoch: null,
            mutationEpoch: null,
            documents: [],
        },
        observedBase: null,
        resulting: null,
        commandOutcomes: [],
        affectedIds: [],
        createdBindings: [],
        warnings: [],
        errors: [],
        pendingEffects: input.pendingEffects,
        links: { render: [], analysis: [] },
        compensation: { available: false, commandIds: [] },
        semanticDiff: null,
        modelSummary: 'Fixture receipt for prepareAgentRunPendingEffectContinuation.spec.ts.',
    } as unknown as VerifiedBatchReceipt;
}

describe('prepareAgentRunPendingEffectContinuation', () => {
    beforeEach(() => {
        clearAgentRuns();
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
    });

    it('promotes a generic pending effect without a source revision', () => {
        const runId = 'run-generic-continuation-promotion';
        const batchId = 'batch-generic-continuation-promotion';
        const commandBatch = buildCommandBatch({ runId, batchId });
        const genericEffect: FixturePendingEffect = {
            commandId: 'command-generic-continuation-promotion',
            kind: 'external-effect',
            operation: 'publishTrackAdded',
            reason: 'Arrangement event bus is offline',
            remediation: 'reconcile',
            state: 'pending',
        };
        const receipt = buildReceipt({ runId, batchId, pendingEffects: [genericEffect] });
        createAgentRun({
            runId,
            request: 'Add a track through a batch whose bus publication is interrupted.',
            mode: 'apply',
            createdRevision: 'revision-continuation-base',
            createdAt: 1,
        });

        const { promote } = prepareAgentRunPendingEffectContinuation({
            runId,
            receipt,
            commandBatch,
            getFinalizedRevision: () => 'revision-finalized',
        });

        expect(() => promote({ receipt })).not.toThrow();

        const ledger = readAgentRunState().pendingEffectRecoveryLedger ?? [];
        expect(ledger).toHaveLength(1);
        const [ledgerEntry] = ledger;
        expect(ledgerEntry?.checkpoint).toBe('durable');
        expect(ledgerEntry?.effects).toEqual(receipt.pendingEffects);
        expect(ledgerEntry?.recovery).toBe('manual-repair');
        expect(ledgerEntry?.lastError).toBe(MISSING_EXACT_CHECKPOINT_RECOVERY_REASON);
        expect(ledgerEntry ? 'sourceRevision' in ledgerEntry : true).toBe(false);

        const continuations = getAgentRun(runId)?.pendingEffectContinuations ?? [];
        expect(continuations).toHaveLength(1);
        const [continuation] = continuations;
        expect(continuation?.batchId).toBe(batchId);
        expect(continuation?.effects).toEqual(receipt.pendingEffects);
        expect(continuation?.recovery).toBe('manual-repair');
        expect(continuation ? 'sourceRevision' in continuation : true).toBe(false);
    });

    it('keeps its source revision when every pending effect is a section render', () => {
        const runId = 'run-render-continuation-promotion';
        const batchId = 'batch-render-continuation-promotion';
        const commandBatch = buildCommandBatch({ runId, batchId });
        const renderEffect: FixturePendingEffect = {
            commandId: 'command-render-continuation-promotion',
            kind: 'external-effect',
            operation: 'renderProjectSections',
            reason: 'Arrangement event bus is offline',
            remediation: 'reconcile',
            state: 'pending',
        };
        const receipt = buildReceipt({ runId, batchId, pendingEffects: [renderEffect] });
        createAgentRun({
            runId,
            request: 'Render a section through a batch whose bus publication is interrupted.',
            mode: 'apply',
            createdRevision: 'revision-continuation-base',
            createdAt: 1,
        });

        const { promote } = prepareAgentRunPendingEffectContinuation({
            runId,
            receipt,
            commandBatch,
            getFinalizedRevision: () => 'revision-finalized',
        });

        expect(() => promote({ receipt })).not.toThrow();

        const ledger = readAgentRunState().pendingEffectRecoveryLedger ?? [];
        expect(ledger).toHaveLength(1);
        const [ledgerEntry] = ledger;
        expect(ledgerEntry?.checkpoint).toBe('durable');
        expect(ledgerEntry?.sourceRevision).toBe('revision-finalized');
        expect(ledgerEntry?.recovery).toBe('reconcile-batch');
    });

    it('stays prepared when a section render has no finalized revision', () => {
        const runId = 'run-unfinalized-continuation-promotion';
        const batchId = 'batch-unfinalized-continuation-promotion';
        const commandBatch = buildCommandBatch({ runId, batchId });
        const renderEffect: FixturePendingEffect = {
            commandId: 'command-unfinalized-continuation-promotion',
            kind: 'external-effect',
            operation: 'renderProjectSections',
            reason: 'Arrangement event bus is offline',
            remediation: 'reconcile',
            state: 'pending',
        };
        const receipt = buildReceipt({ runId, batchId, pendingEffects: [renderEffect] });
        createAgentRun({
            runId,
            request: 'Render a section through a batch whose finalized revision is unavailable.',
            mode: 'apply',
            createdRevision: 'revision-continuation-base',
            createdAt: 1,
        });

        const { promote } = prepareAgentRunPendingEffectContinuation({
            runId,
            receipt,
            commandBatch,
            getFinalizedRevision: () => undefined,
        });

        promote({ receipt });

        const ledger = readAgentRunState().pendingEffectRecoveryLedger ?? [];
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.checkpoint).toBe('prepared');
        expect(getAgentRun(runId)?.pendingEffectContinuations).toEqual([]);
    });
});
