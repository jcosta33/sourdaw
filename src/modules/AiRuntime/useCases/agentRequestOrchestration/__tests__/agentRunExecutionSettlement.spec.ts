import { parse } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { readAgentRunState, sanitizeAgentRunState } from '../../../stores/agentRunStore';
import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { selectAgentRunPendingEffectRecoveries } from '../../../stores/selectAgentRunPendingEffectRecoveries';
import { agentRunLifecycle } from '../../agentRunLifecycle';
import { agentRunExecutionSettlement } from '../agentRunExecutionSettlement';
import { AGENT_RUN_PERSISTENCE_WARNING } from '../settleAgentRunWorkLeaseSafely';

const action = { type: 'setTempo', payload: { bpm: 132 } } satisfies AppAction;

function createConfirmation(): PendingAppActionConfirmation {
    const command = createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect: 'Tempo changes to 132 BPM.',
        normalizedProjectRevision: 'revision-1',
        objectReferences: [],
        parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
        reason: 'Apply the confirmed tempo change.',
        time: [],
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-1',
        batchId: 'batch-1',
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: 'Set tempo to 132 BPM.',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    return {
        id: 'confirmation-1',
        runId: 'run-1',
        prompt: 'Set tempo to 132 BPM.',
        assistantMessageId: 'assistant-1',
        actions: [action],
        actionLabels: ['Set tempo to 132 BPM'],
        affectedIds: [],
        protectedUnchanged: [],
        risk: null,
        executedActions: [],
        status: 'accepted',
        error: null,
        followUpProjectRevision: null,
        followUpStatus: null,
        createdAt: 0,
        resolvedAt: null,
        kind: 'app_actions',
        projectRevision: 'revision-1',
        approvalSnapshot: {
            actions: [action],
            actionLabels: ['Set tempo to 132 BPM'],
            commandBatch,
            protectedUnchanged: [],
        },
        executionMode: 'atomic',
    };
}

function createReceipt(confirmation: PendingAppActionConfirmation, pendingEffects = false) {
    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        throw new Error('Expected confirmed receipt fixture to include its command batch.');
    }
    const parsedBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedBatch.status === 'invalid') {
        throw new Error(parsedBatch.reason);
    }
    const commandId = parsedBatch.envelope.commands[0]?.commandId;
    if (!commandId) {
        throw new Error('Expected confirmed receipt fixture to include one command.');
    }
    return createVerifiedBatchReceipt({
        contentHash: pendingEffects ? 'partial-receipt' : 'committed-receipt',
        envelope: parsedBatch.envelope,
        observedBaseRevision: 'revision-1',
        resultingRevision: 'revision-2',
        result: pendingEffects
            ? {
                  status: 'committed-with-warning',
                  warning: 'Runtime follow-up remains pending.',
                  actions: [],
                  warningDetails: [
                      {
                          kind: 'external-effect',
                          message: 'Runtime follow-up remains pending.',
                          commandId,
                          pendingEffect: {
                              commandId,
                              kind: 'runtime-graph',
                              operation: 'setTempo',
                              reason: 'Runtime follow-up remains pending.',
                              remediation: 'repair',
                              state: 'pending',
                          },
                      },
                  ],
              }
            : { status: 'committed', actions: [] },
    });
}

describe('agentRunExecutionSettlement', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
    });

    it('terminalizes post-commit recovery failure without rewriting the committed batch', () => {
        const confirmation = createConfirmation();
        const receiptIdentity = '1:run-1:batch-1:committed';
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'planning',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: {
                batchId: 'batch-1',
                commandIds: [],
                status: 'executing',
                receiptIdentity: null,
            },
        });
        agentRunLifecycle.recordCommittedWork({
            runId: confirmation.runId,
            workId: 'batch-1',
            receiptIdentity,
            completesRun: false,
        });

        agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receiptIdentity,
        });

        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            batches: [{ batchId: 'batch-1', status: 'committed', receiptIdentity }],
            committedWork: [{ workId: 'batch-1', receiptIdentity }],
            errors: [
                expect.objectContaining({
                    category: 'internal',
                    workId: null,
                    related: expect.objectContaining({
                        receiptIdentities: [receiptIdentity],
                        workIds: [],
                    }),
                }),
            ],
        });
    });

    it('atomically records committed recovery before terminalizing a pre-write receipt failure', () => {
        const confirmation = createConfirmation();
        const receipt = createReceipt(confirmation);
        const receiptIdentity = `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'executing' });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });

        agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: confirmation.actions,
            commandBatch: confirmation.approvalSnapshot.commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });

        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            batches: [{ batchId: 'batch-1', status: 'committed', receiptIdentity }],
            committedWork: [{ workId: 'batch-1', receiptIdentity, revertGroupId: 'batch-1' }],
            errors: [
                expect.objectContaining({
                    category: 'internal',
                    workId: null,
                    related: expect.objectContaining({ receiptIdentities: [receiptIdentity], workIds: [] }),
                }),
            ],
        });

        agentRunLifecycle.cancel({ runId: confirmation.runId, reason: 'Cancellation raced with recovery.' });

        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            batches: [{ batchId: 'batch-1', status: 'committed', receiptIdentity }],
        });
    });

    it('keeps atomic committed recovery terminal when local storage rejects its write', () => {
        const confirmation = createConfirmation();
        const receipt = createReceipt(confirmation);
        const receiptIdentity = `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'executing' });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        try {
            expect(
                agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
                    category: 'internal',
                    retriable: false,
                    receipt,
                    actions: confirmation.actions,
                    commandBatch: confirmation.approvalSnapshot.commandBatch,
                    revertGroupId: 'batch-1',
                    committedRevision: 'revision-2',
                })
            ).toBe(AGENT_RUN_PERSISTENCE_WARNING);
        } finally {
            setItem.mockRestore();
        }

        agentRunLifecycle.cancel({ runId: confirmation.runId, reason: 'Cancellation raced with recovery.' });

        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({
            phase: 'partially-completed',
            committedWork: [{ workId: 'batch-1', receiptIdentity, revertGroupId: 'batch-1' }],
            errors: [expect.objectContaining({ workId: null })],
        });
    });

    it('persists a partial receipt recovery in one write for reload discovery', () => {
        const confirmation = createConfirmation();
        const receipt = createReceipt(confirmation, true);
        const receiptIdentity = `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'executing' });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        setItem.mockClear();

        agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: confirmation.actions,
            commandBatch: confirmation.approvalSnapshot.commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });

        expect(setItem).toHaveBeenCalledExactlyOnceWith('sourdaw-agent-runs', expect.any(String));
        setItem.mockRestore();
        expect(readAgentRunState().runs[0]).toMatchObject({
            pendingEffectContinuations: [expect.objectContaining({ batchId: 'batch-1' })],
        });
        const persisted = window.localStorage.getItem('sourdaw-agent-runs');
        if (!persisted) {
            throw new Error('Expected atomic recovery settlement to persist the AgentRun state.');
        }
        const reloadedState = sanitizeAgentRunState(parse(persisted));
        expect(selectAgentRunPendingEffectRecoveries(reloadedState)).toEqual([
            expect.objectContaining({
                runId: confirmation.runId,
                batchId: 'batch-1',
                effects: receipt.pendingEffects,
            }),
        ]);
        expect(reloadedState.runs).toEqual([
            expect.objectContaining({
                phase: 'partially-completed',
                revisions: expect.objectContaining({ committed: 'revision-2' }),
                committedWork: [
                    expect.objectContaining({
                        workId: 'batch-1',
                        receiptIdentity,
                        revertGroupId: 'batch-1',
                    }),
                ],
            }),
        ]);
        expect(readAgentRunState().runs[0]).toMatchObject({ phase: 'partially-completed' });
    });

    it('persists an ordinary committed recovery failure in one write for terminal reload recovery', () => {
        const confirmation = createConfirmation();
        const receipt = createReceipt(confirmation);
        const receiptIdentity = `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'planning' });
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'executing' });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        setItem.mockClear();

        agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
            category: 'internal',
            retriable: false,
            receipt,
            actions: confirmation.actions,
            commandBatch: confirmation.approvalSnapshot.commandBatch,
            revertGroupId: 'batch-1',
            committedRevision: 'revision-2',
        });

        expect(setItem).toHaveBeenCalledExactlyOnceWith('sourdaw-agent-runs', expect.any(String));
        setItem.mockRestore();
        const persisted = window.localStorage.getItem('sourdaw-agent-runs');
        if (!persisted) {
            throw new Error('Expected ordinary committed recovery settlement to persist the AgentRun state.');
        }
        const reloadedState = sanitizeAgentRunState(parse(persisted));
        expect(selectAgentRunPendingEffectRecoveries(reloadedState)).toEqual([]);
        expect(reloadedState.runs).toEqual([
            expect.objectContaining({
                phase: 'partially-completed',
                revisions: expect.objectContaining({ committed: 'revision-2' }),
                batches: [expect.objectContaining({ batchId: 'batch-1', status: 'committed', receiptIdentity })],
                committedWork: [
                    expect.objectContaining({
                        workId: 'batch-1',
                        receiptIdentity,
                        revertGroupId: 'batch-1',
                    }),
                ],
                errors: [expect.objectContaining({ workId: null })],
            }),
        ]);

        agentRunLifecycle.cancel({ runId: confirmation.runId, reason: 'Cancellation raced with terminal recovery.' });
        expect(agentRunLifecycle.get(confirmation.runId)).toMatchObject({ phase: 'partially-completed' });
    });

    it('returns a persistence warning when terminal recovery settlement cannot be saved', () => {
        const confirmation = createConfirmation();
        const receiptIdentity = '1:run-1:batch-1:committed';
        agentRunLifecycle.create({
            runId: confirmation.runId,
            request: confirmation.prompt,
            mode: 'apply',
            createdRevision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'planning',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
        agentRunLifecycle.recordBatch({
            runId: confirmation.runId,
            batch: { batchId: 'batch-1', commandIds: [], status: 'executing', receiptIdentity: null },
        });
        agentRunLifecycle.recordCommittedWork({
            runId: confirmation.runId,
            workId: 'batch-1',
            receiptIdentity,
            completesRun: false,
        });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });

        try {
            expect(
                agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
                    category: 'internal',
                    retriable: false,
                    receiptIdentity,
                })
            ).toBe(AGENT_RUN_PERSISTENCE_WARNING);
        } finally {
            setItem.mockRestore();
        }
    });
});
