import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    generateGroupId,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { executeImmediatePromptCommand } from '../executeImmediatePromptCommand';

import type { executePlannedActions } from '../../executePlannedActions';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(),
    executePlannedActions: vi.fn(),
    recordReceiptSaga: vi.fn(),
    transitionPhase: vi.fn(),
    claimLease: vi.fn(),
    settleLease: vi.fn(),
    bindAbortController: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));
vi.mock('../../executePlannedActions', () => ({ executePlannedActions: mocks.executePlannedActions }));
vi.mock('../../recordAgentRunReceiptSaga', () => ({ recordAgentRunReceiptSaga: mocks.recordReceiptSaga }));
vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: vi.fn(),
        recordError: vi.fn(),
    },
}));
vi.mock('../../agentRunWorkLease', () => ({
    agentRunWorkLease: { claim: mocks.claimLease, settle: mocks.settleLease },
}));
vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: { bindAbortController: mocks.bindAbortController, cancel: vi.fn() },
}));
vi.mock('../../../stores/chatStore', () => ({ updateChatMessage: mocks.updateChatMessage }));
vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    AGENT_RUN_PERSISTENCE_WARNING: 'persistence warning',
    settleAgentRunWorkLeaseSafely: () => ({ accepted: true, warning: null }),
}));

type PlannedResult = Awaited<ReturnType<typeof executePlannedActions>>;

const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies AppAction;

async function createFixture() {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        expectedEffect: 'Set tempo',
        normalizedProjectRevision: 'revision-R1',
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-immediate',
        batchId: 'batch-immediate',
        projectId: 'project-immediate',
        baseRevision: 'revision-R1',
        intent: 'Set tempo',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    const commandEnvelope = parsedCommandBatch.envelope.commands[0];
    if (!commandEnvelope) {
        throw new Error('Expected one command.');
    }
    const receipt = createVerifiedBatchReceipt({
        contentHash: 'committed-receipt',
        envelope: parsedCommandBatch.envelope,
        observedBaseRevision: 'revision-R1',
        resultingRevision: 'revision-R2',
        result: {
            status: 'committed',
            actions: [
                {
                    action,
                    receipt: createVersionedCommandReceipt({
                        envelope: commandEnvelope,
                        compensation: { available: false, strategy: 'none' },
                    }),
                },
            ],
        },
    });
    return { commandBatch, parsedCommandBatch, receipt };
}

describe('executeImmediatePromptCommand', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        registerHandlerMap(getTransportHandlers());
        mocks.captureProjectRevision.mockReturnValue('revision-R2');
        mocks.claimLease.mockReturnValue({ status: 'claimed', lease: { leaseId: 'lease-immediate' } });
        mocks.bindAbortController.mockReturnValue(vi.fn());
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('persists the finalized revision after deferred execution despite a later project mutation', async () => {
        const { commandBatch, parsedCommandBatch, receipt } = await createFixture();
        let completeExecution: ((result: PlannedResult) => void) | undefined;
        mocks.executePlannedActions.mockImplementation(
            () =>
                new Promise<PlannedResult>((resolve) => {
                    completeExecution = resolve;
                })
        );

        const execution = executeImmediatePromptCommand({
            runId: 'run-immediate',
            prompt: 'Set tempo',
            actions: [action],
            assistantMessageId: 'assistant-immediate',
            abortController: new AbortController(),
            projectRevision: 'revision-R1',
            executionMode: 'atomic',
            group: generateGroupId('Set tempo'),
            commandBatch,
            parsedCommandBatch,
            onExecutionSettlementWarning: vi.fn(),
        });
        await vi.waitFor(() => expect(mocks.executePlannedActions).toHaveBeenCalledOnce());
        mocks.captureProjectRevision.mockReturnValue('revision-R3');
        completeExecution?.({
            status: 'committed',
            actions: [{ actionType: 'setTempo', label: 'Set tempo' }],
            receipt,
            committedRevision: 'revision-R2',
        });

        await expect(execution).resolves.toBe(receipt);
        expect(mocks.recordReceiptSaga).toHaveBeenCalledWith(
            expect.objectContaining({ committedRevision: 'revision-R2', receipt })
        );
        expect(mocks.captureProjectRevision).not.toHaveBeenCalled();
    });
});
