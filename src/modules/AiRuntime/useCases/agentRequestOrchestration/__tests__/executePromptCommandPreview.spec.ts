import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { executePromptCommandPreview } from '../executePromptCommandPreview';

const COMMAND_ID = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
    bindAbortController: vi.fn(),
    cancel: vi.fn(),
    captureProjectRevision: vi.fn(),
    claim: vi.fn(),
    createResourceLease: vi.fn(),
    executeBatch: vi.fn(),
    getRun: vi.fn(),
    loggerError: vi.fn(),
    onSettlementWarning: vi.fn(),
    settle: vi.fn(),
    settleSafely: vi.fn(),
    transitionPhase: vi.fn(),
    updateBatchStatus: vi.fn(),
    updateChatMessage: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeVersionedCommandBatchEnvelope: mocks.executeBatch,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../../../stores/chatStore', () => ({
    updateChatMessage: mocks.updateChatMessage,
}));

vi.mock('../../agentReference/createStemImportConfirmationResourceLease', () => ({
    createStemImportConfirmationResourceLease: mocks.createResourceLease,
}));

vi.mock('../../agentRunLifecycle', () => ({
    agentRunLifecycle: {
        get: mocks.getRun,
        transitionPhase: mocks.transitionPhase,
        updateBatchStatus: mocks.updateBatchStatus,
    },
}));

vi.mock('../../agentRunWorkLease', () => ({
    agentRunWorkLease: {
        claim: mocks.claim,
        settle: mocks.settle,
    },
}));

vi.mock('../../cancelAgentRun', () => ({
    agentRunCancellation: {
        bindAbortController: mocks.bindAbortController,
        cancel: mocks.cancel,
    },
}));

vi.mock('../settleAgentRunWorkLeaseSafely', () => ({
    settleAgentRunWorkLeaseSafely: mocks.settleSafely,
}));

function createInput(): Parameters<typeof executePromptCommandPreview>[0] {
    const action = {
        type: 'setTrackGain',
        payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
    } satisfies AppAction;
    const command = {
        ...createVersionedCommandEnvelope({
            action,
            availableDeviceVersions: {},
            expectedEffect: 'Set Kick gain to 0.8.',
            normalizedProjectRevision: 'revision-preview',
            objectReferences: [{ argument: 'trackId', id: 'track-kick', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Preview the Kick gain change.',
            time: [],
        }),
        commandId: COMMAND_ID,
    };
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-preview',
        batchId: 'batch-preview',
        projectId: 'project-preview',
        baseRevision: 'revision-preview',
        intent: 'Preview the Kick gain',
        mode: 'preview',
        commands: [serializeVersionedCommandEnvelope(command)],
    });
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    return {
        runId: 'run-preview',
        assistantMessageId: 'assistant-preview',
        actions: [action],
        actionLabels: ['Set Kick gain'],
        abortController: new AbortController(),
        projectRevision: 'revision-preview',
        commandBatch,
        parsedCommandBatch,
        onExecutionSettlementWarning: mocks.onSettlementWarning,
    };
}

describe('executePromptCommandPreview', () => {
    const lease = { runId: 'run-preview', workId: 'preview:batch-preview' };
    const releaseCancellation = vi.fn();
    const releasePreparedResources = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
        mocks.claim.mockReturnValue({ status: 'claimed', lease });
        mocks.bindAbortController.mockReturnValue(releaseCancellation);
        mocks.createResourceLease.mockReturnValue({ releaseBestEffort: releasePreparedResources });
        releasePreparedResources.mockResolvedValue(undefined);
        mocks.cancel.mockResolvedValue(undefined);
        mocks.captureProjectRevision.mockReturnValue('revision-preview');
        mocks.settleSafely.mockReturnValue({ accepted: true, warning: null });
    });

    it('does not claim or prepare preview work when the preview transition cannot persist', async () => {
        const transitionError = new Error('preview transition failed');
        mocks.transitionPhase.mockImplementation(() => {
            throw transitionError;
        });

        await expect(executePromptCommandPreview(createInput())).rejects.toBe(transitionError);

        expect(mocks.claim).not.toHaveBeenCalled();
        expect(mocks.createResourceLease).not.toHaveBeenCalled();
        expect(mocks.bindAbortController).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
        expect(mocks.settleSafely).not.toHaveBeenCalled();
    });

    it('rejects a non-claimed lease before transition, cancellation binding, or execution', async () => {
        mocks.claim.mockReturnValue({ status: 'already-settled' });
        const input = createInput();

        await expect(executePromptCommandPreview(input)).rejects.toThrow(
            'Agent preview work could not be claimed: already-settled'
        );

        expect(mocks.claim).toHaveBeenCalledWith({
            runId: 'run-preview',
            workId: 'preview:batch-preview',
            ownerKind: 'command',
            cleanupOwner: 'command-preview',
            idempotencyKey: 'preview:run-preview:batch-preview',
            receiptIdentity: 'preview:run-preview:batch-preview',
            idempotent: true,
            retriable: false,
        });
        expect(mocks.transitionPhase).toHaveBeenCalledWith({
            runId: 'run-preview',
            phase: 'previewing',
            revision: 'revision-preview',
        });
        expect(mocks.createResourceLease).not.toHaveBeenCalled();
        expect(mocks.bindAbortController).not.toHaveBeenCalled();
        expect(mocks.executeBatch).not.toHaveBeenCalled();
    });

    it('settles and marks a thrown execution failure before unregistering and awaiting resource cleanup', async () => {
        const executionError = new Error('preview executor failed');
        const settlementError = new Error('preview settlement persistence failed');
        const settlementWarning = 'Preview work recovery state could not be persisted.';
        const ordering: string[] = [];
        mocks.executeBatch.mockImplementation(async () => {
            ordering.push('execute');
            throw executionError;
        });
        mocks.settleSafely.mockImplementation((input) => {
            ordering.push('settle-failed');
            input.reportFailure?.(settlementError);
            return { accepted: false, warning: settlementWarning };
        });
        mocks.updateBatchStatus.mockImplementation(() => ordering.push('batch-failed'));
        releaseCancellation.mockImplementation(() => ordering.push('abort-unregistered'));
        let finishResourceRelease: () => void = () => undefined;
        releasePreparedResources.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    ordering.push('resource-release-started');
                    finishResourceRelease = () => {
                        ordering.push('resource-release-finished');
                        resolve();
                    };
                })
        );

        const input = createInput();
        let rejected = false;
        const pendingPreview = executePromptCommandPreview(input).catch((error: unknown) => {
            rejected = true;
            throw error;
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(rejected).toBe(false);
        expect(ordering).toEqual([
            'execute',
            'settle-failed',
            'batch-failed',
            'abort-unregistered',
            'resource-release-started',
        ]);

        finishResourceRelease();
        await expect(pendingPreview).rejects.toBe(executionError);
        expect(ordering).toEqual([
            'execute',
            'settle-failed',
            'batch-failed',
            'abort-unregistered',
            'resource-release-started',
            'resource-release-finished',
        ]);
        expect(mocks.executeBatch).toHaveBeenCalledWith(input.commandBatch);
        expect(mocks.settleSafely).toHaveBeenCalledWith({
            lease,
            terminalState: 'failed',
            evidence: 'none',
            settle: mocks.settle,
            reportFailure: expect.any(Function),
        });
        expect(mocks.onSettlementWarning).toHaveBeenCalledWith(settlementWarning);
        expect(mocks.loggerError).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Failed preview work lease settlement failed',
                cause: settlementError,
            })
        );
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-preview',
            batchId: 'batch-preview',
            status: 'failed',
        });
        expect(mocks.createResourceLease).toHaveBeenCalledWith('run-preview', input.actions);
        expect(mocks.bindAbortController).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: 'run-preview',
                lease,
                controller: input.abortController,
                reason: 'User cancelled the run while command preview was active.',
            })
        );
    });

    it.each(['cancelled', 'rejected', 'conflicted', 'failed'] satisfies ReadonlyArray<
        'cancelled' | 'rejected' | 'conflicted' | 'failed'
    >)('cancels and settles a %s preview outcome before propagating its reason', async (status) => {
        const reason = `${status} preview reason`;
        const ordering: string[] = [];
        mocks.executeBatch.mockResolvedValue({ status, reason });
        mocks.captureProjectRevision.mockReturnValue('revision-stale');
        mocks.cancel.mockImplementation(async () => {
            ordering.push('cancelled');
        });
        releaseCancellation.mockImplementation(() => ordering.push('abort-unregistered'));
        releasePreparedResources.mockImplementation(async () => {
            ordering.push('prepared-resource-released');
        });
        mocks.settleSafely.mockImplementation(() => {
            ordering.push('settled');
            return { accepted: true, warning: null };
        });
        const input = createInput();

        await expect(executePromptCommandPreview(input)).rejects.toThrow(reason);

        expect(mocks.executeBatch).toHaveBeenCalledWith(input.commandBatch);
        expect(mocks.cancel).toHaveBeenCalledWith({ runId: 'run-preview', reason });
        expect(ordering).toEqual(['cancelled', 'abort-unregistered', 'prepared-resource-released', 'settled']);
        expect(mocks.settleSafely).toHaveBeenCalledWith(
            expect.objectContaining({
                lease,
                terminalState: status === 'cancelled' ? 'cancelled' : 'failed',
                evidence: 'none',
            })
        );
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-preview',
            batchId: 'batch-preview',
            status: 'failed',
        });
        expect(releaseCancellation).toHaveBeenCalledOnce();
        expect(releasePreparedResources).toHaveBeenCalledOnce();
    });

    it('does not cancel a rejected preview when the project revision remains current', async () => {
        mocks.executeBatch.mockResolvedValue({ status: 'rejected', reason: 'preview rejected' });
        const input = createInput();

        await expect(executePromptCommandPreview(input)).rejects.toThrow('preview rejected');

        expect(mocks.executeBatch).toHaveBeenCalledWith(input.commandBatch);
        expect(mocks.captureProjectRevision).toHaveBeenCalledOnce();
        expect(mocks.cancel).not.toHaveBeenCalled();
        expect(mocks.settleSafely).toHaveBeenCalledWith(
            expect.objectContaining({ lease, terminalState: 'failed', evidence: 'none' })
        );
        expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
            runId: 'run-preview',
            batchId: 'batch-preview',
            status: 'failed',
        });
    });

    it.each(['cancelled', 'partially-completed'] satisfies ReadonlyArray<'cancelled' | 'partially-completed'>)(
        'returns quietly when rejected settlement observes an already %s run',
        async (phase) => {
            mocks.executeBatch.mockResolvedValue({ status: 'rejected', reason: 'stale preview' });
            mocks.captureProjectRevision.mockReturnValue('revision-stale');
            mocks.settleSafely.mockReturnValue({ accepted: false, warning: 'stale settlement' });
            mocks.getRun.mockReturnValue({ phase });

            await expect(executePromptCommandPreview(createInput())).resolves.toBeUndefined();

            expect(mocks.cancel).toHaveBeenCalledWith({ runId: 'run-preview', reason: 'stale preview' });
            expect(mocks.updateChatMessage).not.toHaveBeenCalled();
            expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
            expect(mocks.transitionPhase).toHaveBeenCalledTimes(1);
            expect(mocks.transitionPhase).toHaveBeenCalledWith({
                runId: 'run-preview',
                phase: 'previewing',
                revision: 'revision-preview',
            });
        }
    );

    it('rejects an unaccepted non-preview settlement while the run remains live', async () => {
        mocks.executeBatch.mockResolvedValue({ status: 'rejected', reason: 'preview rejected' });
        mocks.settleSafely.mockReturnValue({ accepted: false, warning: 'settlement failed' });
        mocks.getRun.mockReturnValue({ phase: 'previewing' });

        await expect(executePromptCommandPreview(createInput())).rejects.toThrow(
            'Agent preview work could not be settled after a non-preview outcome'
        );

        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
        expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
        expect(mocks.transitionPhase).toHaveBeenCalledTimes(1);
    });

    it.each(['cancelled', 'partially-completed'] satisfies ReadonlyArray<'cancelled' | 'partially-completed'>)(
        'returns quietly when previewed settlement observes an already %s run',
        async (phase) => {
            const releasePreviewResource = vi.fn();
            mocks.executeBatch.mockResolvedValue({
                status: 'previewed',
                resource: { release: releasePreviewResource },
            });
            mocks.settleSafely.mockReturnValue({ accepted: false, warning: 'settlement failed' });
            mocks.getRun.mockReturnValue({ phase });

            await expect(executePromptCommandPreview(createInput())).resolves.toBeUndefined();

            expect(releasePreviewResource).toHaveBeenCalledOnce();
            expect(mocks.updateChatMessage).not.toHaveBeenCalled();
            expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
            expect(mocks.transitionPhase).toHaveBeenCalledTimes(1);
            expect(mocks.transitionPhase).toHaveBeenCalledWith({
                runId: 'run-preview',
                phase: 'previewing',
                revision: 'revision-preview',
            });
        }
    );

    it('rejects an unaccepted previewed settlement while the run remains live', async () => {
        const releasePreviewResource = vi.fn();
        mocks.executeBatch.mockResolvedValue({
            status: 'previewed',
            resource: { release: releasePreviewResource },
        });
        mocks.settleSafely.mockReturnValue({ accepted: false, warning: 'settlement failed' });
        mocks.getRun.mockReturnValue({ phase: 'previewing' });

        await expect(executePromptCommandPreview(createInput())).rejects.toThrow(
            'Agent preview work could not be settled'
        );

        expect(releasePreviewResource).toHaveBeenCalledOnce();
        expect(mocks.updateChatMessage).not.toHaveBeenCalled();
        expect(mocks.updateBatchStatus).not.toHaveBeenCalled();
        expect(mocks.transitionPhase).toHaveBeenCalledTimes(1);
    });

    it.each([
        [null, undefined, true],
        ['Preview persistence warning.', 'Preview persistence warning.', false],
    ] satisfies ReadonlyArray<readonly [string | null, string | undefined, boolean]>)(
        'publishes a preview after cleanup with warning %s',
        async (warning, expectedError, completesRun) => {
            const ordering: string[] = [];
            const releasePreviewResource = vi.fn(() => ordering.push('preview-resource-released'));
            mocks.executeBatch.mockResolvedValue({
                status: 'previewed',
                resource: { release: releasePreviewResource },
            });
            releaseCancellation.mockImplementation(() => ordering.push('abort-unregistered'));
            releasePreparedResources.mockImplementation(async () => {
                ordering.push('prepared-resource-released');
            });
            mocks.settleSafely.mockImplementation(() => {
                ordering.push('work-settled');
                return { accepted: true, warning };
            });
            mocks.updateChatMessage.mockImplementation(() => ordering.push('assistant-updated'));
            mocks.updateBatchStatus.mockImplementation(() => ordering.push('batch-previewed'));
            mocks.transitionPhase.mockImplementation((input) => ordering.push(`phase:${String(input.phase)}`));
            const input = createInput();

            await executePromptCommandPreview(input);

            expect(mocks.executeBatch).toHaveBeenCalledWith(input.commandBatch);
            expect(ordering).toEqual([
                'phase:previewing',
                'abort-unregistered',
                'prepared-resource-released',
                'preview-resource-released',
                'work-settled',
                'assistant-updated',
                'batch-previewed',
                ...(completesRun ? ['phase:completed'] : []),
            ]);
            expect(mocks.updateChatMessage).toHaveBeenCalledWith('assistant-preview', {
                isStreaming: false,
                error: expectedError,
                content: warning
                    ? 'Previewed without changing the project:\n\n- Set Kick gain\n\n_Preview persistence warning._'
                    : 'Previewed without changing the project:\n\n- Set Kick gain',
            });
            expect(mocks.updateBatchStatus).toHaveBeenCalledWith({
                runId: 'run-preview',
                batchId: 'batch-preview',
                status: 'previewed',
            });
            if (completesRun) {
                expect(mocks.transitionPhase).toHaveBeenLastCalledWith({ runId: 'run-preview', phase: 'completed' });
            } else {
                expect(mocks.transitionPhase).toHaveBeenCalledTimes(1);
            }
        }
    );
});
