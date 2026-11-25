import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type ApplicationToolReceipt } from '../../../models/ApplicationOwnedTool';
import { readAgentRunState } from '../../../stores/agentRunStore';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { ApplicationOwnedToolLoopRequestError } from '../../applicationOwnedToolLoop';
import { recordFailedToolLoopEvidence } from '../recordFailedToolLoopEvidence';

const RUN_ID = 'failed-tool-loop-run';
const RECEIPT_BOUND = 1024;
const RECEIPT_MAX_BYTES = 16_384;

function queryReceipt(index: number, data: unknown = {}): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: `query-${String(index)}`,
        toolName: 'project.query',
        turn: 1,
        revision: 'revision-1',
        status: 'success',
        data,
        summary: 'Read the project.',
        warnings: [],
        error: null,
    };
}

/** A receipt whose JSON serialization is exactly `bytes` long, padded through its data. */
function receiptOfBytes(bytes: number): ApplicationToolReceipt {
    const unpadded = new TextEncoder().encode(JSON.stringify(queryReceipt(0, { pad: '' }))).byteLength;
    return queryReceipt(0, { pad: 'x'.repeat(bytes - unpadded) });
}

function loopFailure(receipts: readonly ApplicationToolReceipt[]): ApplicationOwnedToolLoopRequestError {
    return new ApplicationOwnedToolLoopRequestError(new Error('Provider stopped answering.'), receipts, 2);
}

function createRun(): void {
    agentRunLifecycle.create({
        runId: RUN_ID,
        request: 'What is on the vocal?',
        mode: 'plan',
        createdRevision: 'revision-1',
    });
}

describe('recordFailedToolLoopEvidence', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("keeps a failed loop's receipts on the run when its plan can hold them", () => {
        createRun();
        const receipts = [queryReceipt(0), queryReceipt(1)];

        recordFailedToolLoopEvidence(RUN_ID, loopFailure(receipts));

        const plan = agentRunLifecycle.get(RUN_ID)?.plan;
        expect(plan?.applicationToolReceipts).toEqual(receipts);
        expect(plan?.summary).toBe(
            'project.query (query-0) success: Read the project.\nproject.query (query-1) success: Read the project.'
        );
    });

    it('logs and leaves out a receipt larger than the per-call bound, writing nothing', () => {
        createRun();
        const before = readAgentRunState();
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

        recordFailedToolLoopEvidence(RUN_ID, loopFailure([receiptOfBytes(RECEIPT_MAX_BYTES + 1)]));

        expect(readAgentRunState()).toEqual(before);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            `Failed tool loop receipts were not kept: the run's plan cannot keep an application tool receipt larger than ${String(RECEIPT_MAX_BYTES)} bytes`
        );
    });

    it('logs and leaves out receipts past the plan bound, writing nothing', () => {
        createRun();
        const before = readAgentRunState();
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const receipts = Array.from({ length: RECEIPT_BOUND + 1 }, (_, index) => queryReceipt(index));

        recordFailedToolLoopEvidence(RUN_ID, loopFailure(receipts));

        expect(readAgentRunState()).toEqual(before);
        expect(warn).toHaveBeenCalledExactlyOnceWith(
            `Failed tool loop receipts were not kept: the run's plan cannot hold more than ${String(RECEIPT_BOUND)} entries in applicationToolReceipts`
        );
    });

    it('records nothing for a failure that is not a tool loop failure or carries no receipts', () => {
        createRun();
        const before = readAgentRunState();

        recordFailedToolLoopEvidence(RUN_ID, new Error('Provider stopped answering.'));
        recordFailedToolLoopEvidence(RUN_ID, loopFailure([]));

        expect(readAgentRunState()).toEqual(before);
    });

    it('admits the evidence of an unknown run so its write refuses it with its own reason', () => {
        const evidence = {
            runId: 'missing-run',
            summary: 'project.query (query-0) success: Read the project.',
            applicationToolReceipts: [queryReceipt(0)],
            revision: 'revision-1',
            scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
            grants: {
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
            },
            budgets: { limits: {}, consumed: {} },
        };

        expect(agentRunLifecycle.admitApplicationToolEvidence(evidence)).toBeNull();
        expect(() => agentRunLifecycle.recordApplicationToolEvidence(evidence)).toThrow(
            'Unknown agent run: missing-run'
        );
    });
});
