import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    createVersionedCommandEnvelope,
    executeAppActionBatch,
    executeVersionedCommandBatchEnvelope,
    getVersionedCommandBatchCommitProof,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recoverInterruptedAgentRuns } from '../agentRunRecovery';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { executePlannedActions } from '../executePlannedActions';
import { notifyAiChange } from '../notifyAiChange';
import { recordAiActionGroup } from '../recordAiActionGroup';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppActionBatch: vi.fn(),
    executeVersionedCommandBatchEnvelope: vi.fn(),
    generateGroupId: vi.fn((groupLabel: string) => ({ groupId: 'group-1', groupLabel })),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
}));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: vi.fn() }));
vi.mock('../recordAiActionGroup', () => ({ recordAiActionGroup: vi.fn() }));

type BatchExecutionObservation = Parameters<typeof createVerifiedBatchReceipt>[0]['result'];

type BatchFixtureInput = {
    action: AppAction;
    applicationAssignedIds?: Parameters<typeof createVersionedCommandEnvelope>[0]['applicationAssignedIds'];
    batchId: string;
    compensation: NonNullable<Parameters<typeof createVersionedCommandReceipt>[0]['compensation']>;
    expectedEffect: string;
    intent: string;
    objectReferences: Parameters<typeof createVersionedCommandEnvelope>[0]['objectReferences'];
    parameterUnits?: Parameters<typeof createVersionedCommandEnvelope>[0]['parameterUnits'];
    reason: string;
    runId: string;
};

function createBatchFixture(input: BatchFixtureInput) {
    const command = createVersionedCommandEnvelope({
        action: input.action,
        availableDeviceVersions: {},
        applicationAssignedIds: input.applicationAssignedIds ?? [],
        dependencyIds: [],
        expectedEffect: input.expectedEffect,
        normalizedProjectRevision: 'revision-1',
        objectReferences: input.objectReferences,
        parameterUnits: input.parameterUnits ?? [],
        reason: input.reason,
        time: [],
    });
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input.runId,
        batchId: input.batchId,
        projectId: 'project-1',
        baseRevision: 'revision-1',
        intent: input.intent,
        commands: [JSON.stringify(command)],
    });
    const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const receiptCommand = parsed.envelope.commands[0];
    if (!receiptCommand) {
        throw new Error(`Expected ${input.action.type} command in compiled batch`);
    }
    return {
        action: input.action,
        actions: [input.action],
        command: receiptCommand,
        commandBatch,
        compensation: input.compensation,
        envelope: parsed.envelope,
    };
}

const projectFixture = createBatchFixture({
    action: { type: 'muteTrack', payload: { trackId: 'track-1', muted: true, expectedMuted: false } },
    batchId: 'batch-mute-track',
    compensation: { available: true, strategy: 'inverse' },
    expectedEffect: 'Mute the vocals track.',
    intent: 'Mute vocals',
    objectReferences: [{ argument: 'trackId', id: 'track-1', scope: 'stable' }],
    reason: 'Silence the vocals track.',
    runId: 'run-mute-track',
});
const runtimeFixture = createBatchFixture({
    action: { type: 'stopPlayback' },
    batchId: 'batch-stop-playback',
    compensation: { available: false, strategy: 'none' },
    expectedEffect: 'Stop playback.',
    intent: 'Stop playback',
    objectReferences: [],
    reason: 'Stop the transport.',
    runId: 'run-stop-playback',
});
const postCommitFixture = createBatchFixture({
    action: {
        type: 'addDevice',
        payload: { trackId: 'track-1', deviceType: 'builtin-compressor', deviceId: 'device-post-commit' },
    },
    applicationAssignedIds: [{ argument: 'deviceId', value: 'device-post-commit' }],
    batchId: 'batch-add-device',
    compensation: { available: true, strategy: 'inverse' },
    expectedEffect: 'Add a compressor to the vocals track.',
    intent: 'Add compressor',
    objectReferences: [
        { argument: 'trackId', id: 'track-1', scope: 'stable' },
        { argument: 'deviceId', id: 'device-post-commit', scope: 'stable' },
    ],
    reason: 'Add a compressor to the vocals track.',
    runId: 'run-add-device',
});
const tempoFixture = createBatchFixture({
    action: { type: 'setTempo', payload: { bpm: 111 } },
    batchId: 'batch-set-tempo',
    compensation: { available: true, strategy: 'inverse' },
    expectedEffect: 'Set the project tempo to 111 BPM.',
    intent: 'Set the tempo to 111',
    objectReferences: [],
    parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
    reason: 'Apply the requested project tempo.',
    runId: 'run-set-tempo',
});

type BatchFixture = ReturnType<typeof createBatchFixture>;

function receiptAction(fixture: BatchFixture) {
    return {
        action: fixture.action,
        receipt: createVersionedCommandReceipt({
            envelope: fixture.command,
            compensation: fixture.compensation,
        }),
    };
}

async function createReceipt(fixture: BatchFixture, result: BatchExecutionObservation) {
    const proof = await getVersionedCommandBatchCommitProof(fixture.commandBatch);
    const changedProject = result.status === 'committed' || result.status === 'committed-with-warning';
    return createVerifiedBatchReceipt({
        contentHash: proof.contentHash,
        envelope: fixture.envelope,
        observedBaseRevision: fixture.envelope.baseRevision,
        resultingRevision: changedProject ? 'revision-2' : fixture.envelope.baseRevision,
        result,
    });
}

async function committedReceipt(fixture: BatchFixture) {
    return createReceipt(fixture, {
        status: 'committed',
        actions: [receiptAction(fixture)],
    });
}

const deviceEffectFailure = 'native engine unavailable';
const deviceEffectWarning = `addDevice post-commit effect failed: ${deviceEffectFailure}`;
const devicePendingEffect = {
    commandId: postCommitFixture.command.commandId,
    kind: 'runtime-graph',
    operation: 'addDevice',
    reason: deviceEffectFailure,
    remediation: 'repair',
    state: 'pending',
} satisfies NonNullable<BatchExecutionObservation['warningDetails']>[number]['pendingEffect'];

const renderPendingEffect = {
    commandId: postCommitFixture.command.commandId,
    kind: 'external-effect',
    operation: 'renderProjectSections',
    reason: 'renderer unavailable',
    remediation: 'reconcile',
    state: 'pending',
} satisfies NonNullable<BatchExecutionObservation['warningDetails']>[number]['pendingEffect'];

function partiallyCommittedObservation(): BatchExecutionObservation {
    return {
        status: 'committed-with-warning',
        actions: [receiptAction(postCommitFixture)],
        warning: deviceEffectWarning,
        warningDetails: [
            {
                kind: 'external-effect',
                commandId: postCommitFixture.command.commandId,
                message: deviceEffectWarning,
                pendingEffect: devicePendingEffect,
            },
        ],
    };
}

type ReplayExpected = { status: 'no-op' | 'cancelled' } | { status: 'ambiguous' | 'failed'; reason: string };

const unsuccessfulReplayCases: ReadonlyArray<{
    expected: ReplayExpected;
    observation: BatchExecutionObservation;
    outcome: string;
}> = [
    { outcome: 'no-op', observation: { status: 'no-op', actions: [] }, expected: { status: 'no-op' } },
    {
        outcome: 'cancelled',
        observation: { status: 'cancelled', reason: 'authority revoked', actions: [] },
        expected: { status: 'cancelled' },
    },
    {
        outcome: 'ambiguous',
        observation: { status: 'ambiguous', reason: 'Prior ambiguous outcome', actions: [] },
        expected: { status: 'ambiguous', reason: 'Prior ambiguous outcome' },
    },
    {
        outcome: 'rejected',
        observation: { status: 'rejected', reason: 'Prior rejected outcome', actions: [] },
        expected: { status: 'failed', reason: 'Prior rejected outcome' },
    },
    {
        outcome: 'conflicted',
        observation: { status: 'conflicted', reason: 'Prior conflicted outcome', actions: [] },
        expected: { status: 'failed', reason: 'Prior conflicted outcome' },
    },
    {
        outcome: 'verification-failed',
        observation: {
            status: 'conflicted',
            reason: 'Prior verification-failed outcome',
            actions: [],
            failureKind: 'verification',
        },
        expected: { status: 'failed', reason: 'Prior verification-failed outcome' },
    },
    {
        outcome: 'failed',
        observation: { status: 'failed', reason: 'Prior failed outcome', actions: [] },
        expected: { status: 'failed', reason: 'Prior failed outcome' },
    },
];

describe('executePlannedActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentRunLifecycle.clear();
        vi.mocked(recordAiActionGroup).mockReset();
        vi.mocked(notifyAiChange).mockReset();
        vi.mocked(captureProjectRevision).mockReturnValue('revision-1');
    });

    it('retains the exact pending-effect batch across a crash at the auto-commit checkpoint and restart', async () => {
        const receipt = await createReceipt(postCommitFixture, partiallyCommittedObservation());
        expect(receipt.pendingEffects).toEqual([devicePendingEffect]);
        agentRunLifecycle.create({
            runId: receipt.runId,
            request: 'Load external plugin',
            mode: 'apply',
            createdRevision: 'revision-1',
            createdAt: 100,
        });
        agentRunLifecycle.transitionPhase({
            runId: receipt.runId,
            phase: 'planning',
            revision: 'revision-1',
            transitionedAt: 101,
        });
        agentRunLifecycle.transitionPhase({
            runId: receipt.runId,
            phase: 'executing',
            revision: 'revision-1',
            transitionedAt: 102,
        });
        expect(
            agentRunWorkLease.claim({
                runId: receipt.runId,
                workId: receipt.batchId,
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: receipt.batchId,
                receiptIdentity: `command:${receipt.runId}:${receipt.batchId}`,
                idempotent: true,
                retriable: false,
                claimedAt: 103,
            }).status
        ).toBe('claimed');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation(async ({ options }) => {
            const preparation = options?.onProjectCommitCheckpoint?.({ receipt });
            preparation?.promote({ receipt });
            throw new Error('simulated crash after durable project checkpoint');
        });

        await expect(
            executePlannedActions({
                commandBatch: postCommitFixture.commandBatch,
                prompt: 'Load external plugin',
                actions: postCommitFixture.actions,
                projectRevision: 'revision-1',
            })
        ).rejects.toThrow('simulated crash after durable project checkpoint');

        await expect(recoverInterruptedAgentRuns({ recoveredAt: 200 })).resolves.toEqual({
            recoveredRunIds: [receipt.runId],
        });
        expect(agentRunLifecycle.get(receipt.runId)).toMatchObject({
            phase: 'partially-completed',
            manualResume: { required: false },
            pendingEffectContinuations: [
                {
                    batchId: receipt.batchId,
                    effects: [devicePendingEffect],
                    serializedBatch: postCommitFixture.commandBatch.serialized,
                },
            ],
            workLeases: [expect.objectContaining({ workId: receipt.batchId, terminalState: 'orphaned' })],
        });
    });

    it('promotes render-only recovery with the exact finalized project revision', async () => {
        const observation: BatchExecutionObservation = {
            status: 'committed-with-warning',
            actions: [receiptAction(postCommitFixture)],
            warning: renderPendingEffect.reason,
            warningDetails: [
                {
                    kind: 'external-effect',
                    commandId: renderPendingEffect.commandId,
                    message: renderPendingEffect.reason,
                    pendingEffect: renderPendingEffect,
                },
            ],
        };
        const receipt = await createReceipt(postCommitFixture, observation);
        agentRunLifecycle.create({
            runId: receipt.runId,
            request: 'Render the retained section.',
            mode: 'apply',
            createdRevision: 'revision-R1',
            createdAt: 100,
        });
        agentRunLifecycle.recordCommittedWork({
            runId: receipt.runId,
            workId: 'prior-batch',
            receiptIdentity: 'receipt-prior-batch',
            committedRevision: 'revision-R1',
            completesRun: false,
            committedAt: 101,
        });
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation(async ({ options }) => {
            const preparation = options?.onProjectCommitCheckpoint?.({ receipt });
            options?.onProjectCommitFinalized?.({ receipt, revision: 'revision-R2' });
            preparation?.promote({ receipt });
            return {
                status: 'committed-with-warning',
                actions: [{ ...receiptAction(postCommitFixture), label: 'Render retained section' }],
                receipt,
                warning: renderPendingEffect.reason,
                warningDetails: observation.warningDetails ? [...observation.warningDetails] : undefined,
            };
        });

        const result = await executePlannedActions({
            commandBatch: postCommitFixture.commandBatch,
            prompt: 'Render the retained section.',
            actions: postCommitFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toMatchObject({ status: 'committed', committedRevision: 'revision-R2' });
        expect(agentRunLifecycle.get(receipt.runId)?.pendingEffectContinuations[0]?.sourceRevision).toBe('revision-R2');
        expect(readAgentRunState().pendingEffectRecoveryLedger?.[0]?.sourceRevision).toBe('revision-R2');
    });

    it('reports unavailable exact commit provenance without sampling a later project revision', async () => {
        const receipt = await createReceipt(projectFixture, {
            status: 'committed',
            actions: [receiptAction(projectFixture)],
        });
        vi.mocked(captureProjectRevision).mockReturnValue('revision-R3');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation(async ({ options }) => {
            options?.onProjectCommitFinalizationUnavailable?.({ reason: 'revision capture failed at commit' });
            return {
                status: 'committed',
                actions: [{ ...receiptAction(projectFixture), label: 'Mute vocals' }],
                receipt,
            };
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toMatchObject({
            status: 'committed',
            finalizationEvidenceFailure: 'revision capture failed at commit',
        });
        expect(result).not.toHaveProperty('committedRevision');
    });

    it('removes a prepared recovery capsule when the owning project checkpoint aborts', async () => {
        const receipt = await createReceipt(postCommitFixture, partiallyCommittedObservation());
        expect(receipt.pendingEffects).toEqual([devicePendingEffect]);
        agentRunLifecycle.create({
            runId: receipt.runId,
            request: 'Load external plugin',
            mode: 'apply',
            createdRevision: 'revision-1',
            createdAt: 100,
        });
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation(async ({ options }) => {
            const preparation = options?.onProjectCommitCheckpoint?.({ receipt });
            preparation?.discard();
            return { status: 'failed', reason: 'project commit unavailable', actions: [] };
        });

        await expect(
            executePlannedActions({
                commandBatch: postCommitFixture.commandBatch,
                prompt: 'Load external plugin',
                actions: postCommitFixture.actions,
                projectRevision: 'revision-1',
            })
        ).resolves.toEqual({ status: 'failed', reason: 'project commit unavailable' });
        expect(readAgentRunState().pendingEffectRecoveryLedger).toBeUndefined();
        expect(agentRunLifecycle.get(receipt.runId)?.pendingEffectContinuations).toEqual([]);
    });

    it('rejects legacy execution instead of dispatching an unbound action batch', async () => {
        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'failed',
            reason: 'Legacy planned-action execution is not authorized',
        });
        expect(executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('returns a durable idempotent replay without duplicating AI history or notifications', async () => {
        const receipt = await committedReceipt(projectFixture);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'idempotent-replay',
            actions: [],
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({ status: 'committed', actions: [], receipt });
        expect(recordAiActionGroup).not.toHaveBeenCalled();
        expect(notifyAiChange).not.toHaveBeenCalled();
    });

    it('returns the verified receipt from a fresh apply commit', async () => {
        const receipt = await committedReceipt(projectFixture);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ ...receiptAction(projectFixture), label: 'Mute track' }],
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeVersionedCommandBatchEnvelope)).toHaveBeenCalledWith({
            ...projectFixture.commandBatch,
            options: expect.objectContaining({
                groupId: 'group-1',
                source: 'prompt',
                requireCompensation: true,
            }),
        });
        const options = vi.mocked(executeVersionedCommandBatchEnvelope).mock.calls[0]?.[0].options;
        expect(options?.shouldExecute?.()).toBe(true);
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalledWith({
            prompt: 'Mute vocals',
            groupId: 'group-1',
            executionKind: 'project',
            actions: [{ kind: 'appAction', actionType: 'muteTrack', label: 'Mute track' }],
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Mute vocals', ['muteTrack']);
        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'muteTrack', label: 'Mute track' }],
            receipt,
        });
    });

    it('forwards the commit-prepared observer to the authoritative Command boundary', async () => {
        const receipt = await committedReceipt(projectFixture);
        const onProjectCommitPrepared = vi.fn();
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation(async (input) => {
            input.onProjectCommitPrepared?.();
            return {
                status: 'committed',
                actions: [{ ...receiptAction(projectFixture), label: 'Mute track' }],
                receipt,
            };
        });

        await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
            onProjectCommitPrepared,
        });

        expect(onProjectCommitPrepared).toHaveBeenCalledOnce();
    });

    it.each(unsuccessfulReplayCases)(
        'preserves a prior $outcome outcome instead of reporting an idempotent replay as committed',
        async ({ expected, observation }) => {
            const receipt = await createReceipt(projectFixture, observation);
            vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
                status: 'idempotent-replay',
                actions: [],
                receipt,
            });

            const result = await executePlannedActions({
                commandBatch: projectFixture.commandBatch,
                prompt: 'Mute vocals',
                actions: projectFixture.actions,
                projectRevision: 'revision-1',
            });

            expect(result).toEqual(expected);
            expect(recordAiActionGroup).not.toHaveBeenCalled();
            expect(notifyAiChange).not.toHaveBeenCalled();
        }
    );

    it('reports a runtime-only command as executed rather than committed', async () => {
        const receipt = await createReceipt(runtimeFixture, {
            status: 'executed',
            actions: [receiptAction(runtimeFixture)],
        });
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'executed',
            actions: [{ ...receiptAction(runtimeFixture), label: 'Stop playback' }],
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch: runtimeFixture.commandBatch,
            prompt: 'Stop playback',
            actions: runtimeFixture.actions,
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeVersionedCommandBatchEnvelope)).toHaveBeenCalledWith({
            ...runtimeFixture.commandBatch,
            options: expect.objectContaining({ requireCompensation: true }),
        });
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalledWith({
            prompt: 'Stop playback',
            groupId: 'group-1',
            executionKind: 'runtime',
            actions: [{ kind: 'appAction', actionType: 'stopPlayback', label: 'Stop playback' }],
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Stop playback', ['stopPlayback']);
        expect(result).toEqual({
            status: 'executed',
            actions: [{ actionType: 'stopPlayback', label: 'Stop playback' }],
            receipt,
        });
    });

    it('uses executed wording when a runtime follow-up reports a warning', async () => {
        const warning = 'stopPlayback follow-up effect failed: transport unavailable';
        const observation: BatchExecutionObservation = {
            status: 'executed-with-warning',
            actions: [receiptAction(runtimeFixture)],
            warning,
            warningDetails: [
                {
                    kind: 'external-effect',
                    commandId: runtimeFixture.command.commandId,
                    message: warning,
                },
            ],
        };
        const receipt = await createReceipt(runtimeFixture, observation);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'executed-with-warning',
            actions: [{ ...receiptAction(runtimeFixture), label: 'Stop playback' }],
            warning,
            warningDetails: observation.warningDetails ? [...observation.warningDetails] : undefined,
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch: runtimeFixture.commandBatch,
            prompt: 'Stop playback',
            actions: runtimeFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'executed',
            actions: [{ actionType: 'stopPlayback', label: 'Stop playback' }],
            executionWarning: warning,
            receipt,
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            `Executed: Stop playback. Executed with follow-up warning: ${warning}`,
            ['stopPlayback']
        );
    });

    it('reports invalidation when the project revision changes before admission', async () => {
        const receipt = await createReceipt(projectFixture, {
            status: 'cancelled',
            reason: 'authority revoked',
            actions: [],
        });
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation((input) => {
            expect(input.options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({
                status: 'cancelled',
                reason: 'authority revoked',
                actions: [],
                receipt,
            });
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'invalidated',
            reason: 'The project changed after this proposal was created. Review and submit the command again.',
        });
        expect(vi.mocked(recordAiActionGroup)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
    });

    it('reports user cancellation separately from project invalidation', async () => {
        const controller = new AbortController();
        controller.abort();
        const receipt = await createReceipt(projectFixture, {
            status: 'cancelled',
            reason: 'authority revoked',
            actions: [],
        });
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation((input) => {
            expect(input.options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({
                status: 'cancelled',
                reason: 'authority revoked',
                actions: [],
                receipt,
            });
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
            signal: controller.signal,
        });

        expect(result).toEqual({ status: 'cancelled' });
        expect(vi.mocked(recordAiActionGroup)).not.toHaveBeenCalled();
    });

    it('carries a refused action through as a failure reason instead of reporting it dispatched', async () => {
        // The last link in a refusal's path to the caller. A handler that throws
        // — `setTempo` inside a tempo ramp is the case this was written for —
        // becomes a `failed` batch carrying the refusal message
        // (`executeAppActionBatch.spec.ts` pins that half), and this is where
        // that message either reaches the model or is dropped. Dropping it is
        // the original defect: the runtime answered as though the action had
        // been dispatched while nothing in the project had changed.
        const refusal =
            'Cannot set 111 BPM here: the playhead is inside a tempo ramp, where no single tempo event carries the tempo in force.';
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'failed',
            reason: refusal,
            actions: [],
        });

        const result = await executePlannedActions({
            commandBatch: tempoFixture.commandBatch,
            prompt: 'Set the tempo to 111',
            actions: tempoFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({ status: 'failed', reason: refusal });
        // Neither a history entry nor a success notification: both would tell the
        // user something happened.
        expect(vi.mocked(recordAiActionGroup)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
    });

    it('preserves a committed result when post-commit reporting fails', async () => {
        const receipt = await committedReceipt(projectFixture);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ ...receiptAction(projectFixture), label: 'Mute track' }],
            receipt,
        });
        vi.mocked(recordAiActionGroup).mockImplementation(() => {
            throw new Error('history unavailable');
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'muteTrack', label: 'Mute track' }],
            receipt,
            reportingWarning: 'history: history unavailable',
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Mute vocals', ['muteTrack']);
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });

    it('distinguishes a committed observer warning from reporting failures', async () => {
        const warning = 'Committed observer failed: observer unavailable';
        const observation: BatchExecutionObservation = {
            status: 'committed-with-warning',
            actions: [receiptAction(projectFixture)],
            warning,
            warningDetails: [{ kind: 'observer', message: warning }],
        };
        const receipt = await createReceipt(projectFixture, observation);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed-with-warning',
            actions: [{ ...receiptAction(projectFixture), label: 'Mute track' }],
            warning,
            warningDetails: observation.warningDetails ? [...observation.warningDetails] : undefined,
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'muteTrack', label: 'Mute track' }],
            commitWarning: warning,
            receipt,
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            `Executed: Mute vocals. Committed with follow-up warning: ${warning}`,
            ['muteTrack']
        );
    });

    it('preserves a committed result when the success notification throws', async () => {
        const receipt = await committedReceipt(projectFixture);
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ ...receiptAction(projectFixture), label: 'Mute track' }],
            receipt,
        });
        vi.mocked(notifyAiChange).mockImplementation(() => {
            throw new Error('toast unavailable');
        });

        const result = await executePlannedActions({
            commandBatch: projectFixture.commandBatch,
            prompt: 'Mute vocals',
            actions: projectFixture.actions,
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'muteTrack', label: 'Mute track' }],
            receipt,
            reportingWarning: 'notification: toast unavailable',
        });
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalled();
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });
});
