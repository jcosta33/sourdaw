import { parse } from 'superjson';
import { beforeEach, describe, expect, it } from 'vitest';

import { readPersistedAgentRunText } from '../../__tests__/readPersistedAgentRunText';
import { type AgentRunPlan, type AgentRunState } from '../../models/AgentRun';
import { type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { persistAgentRunState, readAgentRunState, sanitizeAgentRunState } from '../../stores/agentRunStore';
import { recordBatchPreviewEvidence } from '../agentRequestOrchestration/recordBatchPreviewEvidence';
import { agentRunLifecycle } from '../agentRunLifecycle';

const RUN_ID = 'bounded-plan-run';
const RECEIPT_BOUND = 1024;
const CAPABILITY_BOUND = 1280;
const RECEIPT_MAX_BYTES = 16_384;

const scope = { targetIds: ['track-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };
const grants = {
    allowedOperationPrefixes: [],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
const budgets = { limits: {}, consumed: {} };

function verificationReceipt(index: number, data: unknown = {}): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: `goal-measure-${String(index)}`,
        toolName: 'analysis.measure',
        turn: 0,
        origin: 'application-verification',
        revision: 'revision-1',
        status: 'success',
        data,
        summary: 'Measured preview.',
        warnings: [],
        error: null,
    };
}

function utf8Bytes(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** A receipt whose JSON serialization is exactly `bytes` long, padded through its data. */
function receiptOfBytes(index: number, bytes: number): ApplicationToolReceipt {
    const unpadded = utf8Bytes(verificationReceipt(index, { pad: '' }));
    const receipt = verificationReceipt(index, { pad: 'x'.repeat(bytes - unpadded) });
    expect(utf8Bytes(receipt)).toBe(bytes);
    return receipt;
}

function receipts(count: number): ApplicationToolReceipt[] {
    return Array.from({ length: count }, (_, index) => verificationReceipt(index));
}

function createRunWithReceipts(planReceipts: ApplicationToolReceipt[]): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'Brighten the vocal.',
        mode: 'plan',
        createdRevision: 'revision-1',
    });
    agentRunLifecycle.recordPlan({
        runId: RUN_ID,
        summary: 'Brighten the vocal.',
        commandIds: [],
        serializedBatchIdentity: null,
        revision: 'revision-1',
        scope,
        grants,
        budgets,
        applicationToolReceipts: planReceipts,
    });
}

function liveRun() {
    const run = agentRunLifecycle.get(RUN_ID);
    if (run?.plan === null || run?.plan === undefined) {
        throw new Error('Expected the recorded run plan.');
    }
    return { run, plan: run.plan };
}

function rawStoredState(): string | null {
    return readPersistedAgentRunText();
}

/** What the next session reads: the stored text, decoded and sanitized exactly as the store loads it. */
function reloadedState(): AgentRunState {
    const raw = rawStoredState();
    if (raw === null) {
        throw new Error('Expected persisted agent run state.');
    }
    return sanitizeAgentRunState(parse<unknown>(raw));
}

function planRecord(plan: AgentRunPlan) {
    return {
        runId: RUN_ID,
        summary: plan.summary,
        commandIds: plan.commandIds,
        serializedBatchIdentity: plan.serializedBatchIdentity,
        revision: 'revision-2',
        scope,
        grants,
        budgets,
        plan,
    };
}

function capabilities(count: number): AgentRunPlan['capabilities'] {
    return Array.from({ length: count }, (_, index) => ({
        id: `analysis.measure-${String(index)}`,
        source: 'application-tool-catalog',
        prerequisite: 'Application tool analysis.measure returned success.',
        status: 'available',
    }));
}

describe('agent run plan admission', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    it('refuses a batch preview receipt past the plan bound and leaves the run as it was', () => {
        createRunWithReceipts(receipts(RECEIPT_BOUND));
        const before = readAgentRunState();
        const storedBefore = rawStoredState();

        const refusal = recordBatchPreviewEvidence(liveRun().run, 'revision-2', undefined, [
            verificationReceipt(RECEIPT_BOUND),
        ]);

        expect(refusal).toEqual({
            status: 'refused',
            reason: 'collection-bound',
            collection: 'applicationToolReceipts',
            bound: RECEIPT_BOUND,
        });
        expect(readAgentRunState()).toEqual(before);
        expect(rawStoredState()).toBe(storedBefore);
        persistAgentRunState(readAgentRunState());
        expect(reloadedState().runs.map((run) => run.plan?.applicationToolReceipts)).toEqual([receipts(RECEIPT_BOUND)]);
    });

    it('refuses the plan write itself before persisting when its caller did not ask first', () => {
        createRunWithReceipts(receipts(RECEIPT_BOUND));
        const storedBefore = rawStoredState();
        const { plan } = liveRun();

        expect(() =>
            agentRunLifecycle.recordPlan(planRecord({ ...plan, applicationToolReceipts: receipts(RECEIPT_BOUND + 1) }))
        ).toThrow("the run's plan cannot hold more than 1024 entries in applicationToolReceipts");
        expect(rawStoredState()).toBe(storedBefore);
        expect(reloadedState().runs[0]?.plan?.applicationToolReceipts).toHaveLength(RECEIPT_BOUND);
    });

    it('refuses a plan deriving one capability past its own bound', () => {
        createRunWithReceipts([]);
        const storedBefore = rawStoredState();
        const { plan } = liveRun();
        const overfull = planRecord({ ...plan, capabilities: capabilities(CAPABILITY_BOUND + 1) });

        expect(agentRunLifecycle.admitPlan(overfull)).toEqual({
            status: 'refused',
            reason: 'collection-bound',
            collection: 'capabilities',
            bound: CAPABILITY_BOUND,
        });
        expect(() => agentRunLifecycle.recordPlan(overfull)).toThrow(
            "the run's plan cannot hold more than 1280 entries in capabilities"
        );
        expect(rawStoredState()).toBe(storedBefore);

        const atBound = planRecord({ ...plan, capabilities: capabilities(CAPABILITY_BOUND) });
        expect(agentRunLifecycle.admitPlan(atBound)).toBeNull();
        agentRunLifecycle.recordPlan(atBound);
        expect(reloadedState().runs[0]?.plan?.capabilities).toEqual(capabilities(CAPABILITY_BOUND));
    });

    it('refuses evidence whose receipt is larger than the per-call bound', () => {
        createRunWithReceipts([]);
        const before = readAgentRunState();

        const refusal = recordBatchPreviewEvidence(liveRun().run, 'revision-2', undefined, [
            receiptOfBytes(0, RECEIPT_MAX_BYTES + 1),
        ]);

        expect(refusal).toEqual({
            status: 'refused',
            reason: 'receipt-bytes',
            collection: 'applicationToolReceipts',
            bound: RECEIPT_MAX_BYTES,
        });
        expect(readAgentRunState()).toEqual(before);
    });

    it('reloads a run written at every bound with each of its receipts', () => {
        const atBound = [...receipts(RECEIPT_BOUND - 1), receiptOfBytes(RECEIPT_BOUND - 1, RECEIPT_MAX_BYTES)];
        createRunWithReceipts(atBound);

        const reloaded = reloadedState();

        expect(reloaded.runs.map((run) => run.runId)).toEqual([RUN_ID]);
        expect(reloaded.runs[0]?.plan?.applicationToolReceipts).toEqual(atBound);
    });

    it('drops on restore a stored run whose receipt is larger than the per-call bound', () => {
        createRunWithReceipts([verificationReceipt(0)]);
        const state = readAgentRunState();
        const withReceipt = (receipt: ApplicationToolReceipt): unknown => ({
            ...state,
            runs: state.runs.map((run) => ({
                ...run,
                plan: run.plan === null ? null : { ...run.plan, applicationToolReceipts: [receipt] },
            })),
        });

        expect(sanitizeAgentRunState(withReceipt(receiptOfBytes(0, RECEIPT_MAX_BYTES + 1))).runs).toEqual([]);
        const kept = receiptOfBytes(0, RECEIPT_MAX_BYTES);
        expect(sanitizeAgentRunState(withReceipt(kept)).runs.map((run) => run.plan?.applicationToolReceipts)).toEqual([
            [kept],
        ]);
    });
});
