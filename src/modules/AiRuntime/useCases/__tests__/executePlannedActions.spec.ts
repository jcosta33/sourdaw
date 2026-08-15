import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { executeAppActionBatch, executeVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { executePlannedActions } from '../executePlannedActions';
import { notifyAiChange } from '../notifyAiChange';
import { recordAiActionGroup } from '../recordAiActionGroup';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppActionBatch: vi.fn(),
    executeVersionedCommandBatchEnvelope: vi.fn(),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'Mute vocals' })),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
}));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: vi.fn() }));
vi.mock('../recordAiActionGroup', () => ({ recordAiActionGroup: vi.fn() }));

const action = { type: 'togglePlayback' } as const;
const runtimeAction = { type: 'setPlayback', payload: { playing: true } } as const;
const commandBatch = {
    authority: {
        projectId: 'project-1',
        baseRevision: 'revision-1',
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
        budgets: {
            maxCommands: 1,
            maxCreatedTracks: 0,
            maxDeletedObjects: 0,
            maxAffectedTracks: 0,
            maxAffectedClips: 0,
            maxAutomationPoints: 0,
            maxImportedAssets: 0,
            maxRenderJobs: 0,
        },
    },
    serialized: '{}',
} as const;

type ReplayOutcome =
    | 'committed'
    | 'committed-with-warning'
    | 'executed'
    | 'executed-with-warning'
    | 'no-op'
    | 'ambiguous'
    | 'rejected'
    | 'conflicted'
    | 'cancelled'
    | 'failed'
    | 'partially-committed'
    | 'verification-failed';

function idempotentReplayResult(outcome: ReplayOutcome, errors: string[] = []) {
    return {
        status: 'idempotent-replay' as const,
        actions: [] as [],
        receipt: {
            schemaVersion: 1 as const,
            runId: 'run-1',
            batchId: 'batch-1',
            outcome,
            atomicity: 'atomic' as const,
            base: {
                normalizedRevision: 'revision-1',
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
            errors,
            links: { render: [], analysis: [] },
            compensation: { available: false, commandIds: [] },
            semanticDiff: null,
            modelSummary: `Prior batch outcome: ${outcome}.`,
        },
    };
}

describe('executePlannedActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(recordAiActionGroup).mockReset();
        vi.mocked(notifyAiChange).mockReset();
        vi.mocked(captureProjectRevision).mockReturnValue('revision-1');
    });

    it('rejects legacy execution instead of dispatching an unbound action batch', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'failed',
            reason: 'Legacy planned-action execution is not authorized',
        });
        expect(executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('returns a durable idempotent replay without duplicating AI history or notifications', async () => {
        const replayResult = idempotentReplayResult('committed');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue(replayResult);

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({ status: 'committed', actions: [], receipt: replayResult.receipt });
        expect(recordAiActionGroup).not.toHaveBeenCalled();
        expect(notifyAiChange).not.toHaveBeenCalled();
    });

    it('returns the verified receipt from a fresh apply commit', async () => {
        const receipt = idempotentReplayResult('committed').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeVersionedCommandBatchEnvelope)).toHaveBeenCalledWith({
            ...commandBatch,
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
            actions: [{ kind: 'appAction', actionType: 'togglePlayback', label: 'Toggle playback' }],
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Mute vocals', ['togglePlayback']);
        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt,
        });
    });

    it.each([
        ['no-op', { status: 'no-op' }],
        ['cancelled', { status: 'cancelled' }],
        ['ambiguous', { status: 'ambiguous', reason: 'Prior ambiguous outcome' }],
        ['rejected', { status: 'failed', reason: 'Prior rejected outcome' }],
        ['conflicted', { status: 'failed', reason: 'Prior conflicted outcome' }],
        ['verification-failed', { status: 'failed', reason: 'Prior verification-failed outcome' }],
        ['failed', { status: 'failed', reason: 'Prior failed outcome' }],
    ] as const)(
        'preserves a prior %s outcome instead of reporting an idempotent replay as committed',
        async (outcome, expected) => {
            const reason = `Prior ${outcome} outcome`;
            vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue(
                idempotentReplayResult(outcome, outcome === 'no-op' || outcome === 'cancelled' ? [] : [reason])
            );

            const result = await executePlannedActions({
                commandBatch,
                prompt: 'Mute vocals',
                actions: [action],
                projectRevision: 'revision-1',
            });

            expect(result).toEqual(expected);
            expect(recordAiActionGroup).not.toHaveBeenCalled();
            expect(notifyAiChange).not.toHaveBeenCalled();
        }
    );

    it('reports a runtime-only command as executed rather than committed', async () => {
        const receipt = idempotentReplayResult('executed').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'executed',
            actions: [{ action: runtimeAction, label: 'Start playback' }],
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Start playback',
            actions: [runtimeAction],
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeVersionedCommandBatchEnvelope)).toHaveBeenCalledWith({
            ...commandBatch,
            options: expect.objectContaining({ requireCompensation: true }),
        });
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalledWith({
            prompt: 'Start playback',
            groupId: 'group-1',
            executionKind: 'runtime',
            actions: [{ kind: 'appAction', actionType: 'setPlayback', label: 'Start playback' }],
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Start playback', ['setPlayback']);
        expect(result).toEqual({
            status: 'executed',
            actions: [{ actionType: 'setPlayback', label: 'Start playback' }],
            receipt,
        });
    });

    it('uses executed wording when a runtime follow-up reports a warning', async () => {
        const receipt = idempotentReplayResult('executed-with-warning').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'executed-with-warning',
            actions: [{ action: runtimeAction, label: 'Start playback' }],
            warning: 'setPlayback follow-up effect failed: transport unavailable',
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Start playback',
            actions: [runtimeAction],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'executed',
            actions: [{ actionType: 'setPlayback', label: 'Start playback' }],
            executionWarning: 'setPlayback follow-up effect failed: transport unavailable',
            receipt,
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Executed: Start playback. Executed with follow-up warning: setPlayback follow-up effect failed: transport unavailable',
            ['setPlayback']
        );
    });

    it('reports invalidation when the project revision changes before admission', async () => {
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation((input) => {
            expect(input.options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({
                status: 'cancelled',
                reason: 'authority revoked',
                actions: [],
                receipt: idempotentReplayResult('cancelled').receipt,
            });
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
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
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        vi.mocked(executeVersionedCommandBatchEnvelope).mockImplementation((input) => {
            expect(input.options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({
                status: 'cancelled',
                reason: 'authority revoked',
                actions: [],
                receipt: idempotentReplayResult('cancelled').receipt,
            });
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
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
            commandBatch,
            prompt: 'Set the tempo to 111',
            actions: [{ type: 'setTempo', payload: { bpm: 111 } }],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({ status: 'failed', reason: refusal });
        // Neither a history entry nor a success notification: both would tell the
        // user something happened.
        expect(vi.mocked(recordAiActionGroup)).not.toHaveBeenCalled();
        expect(vi.mocked(notifyAiChange)).not.toHaveBeenCalled();
    });

    it('preserves a committed result when post-commit reporting fails', async () => {
        const receipt = idempotentReplayResult('committed').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
            receipt,
        });
        vi.mocked(recordAiActionGroup).mockImplementation(() => {
            throw new Error('history unavailable');
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt,
            reportingWarning: 'history: history unavailable',
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Mute vocals', ['togglePlayback']);
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });

    it('distinguishes a committed post-commit effect warning from reporting failures', async () => {
        const receipt = idempotentReplayResult('committed-with-warning').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed-with-warning',
            actions: [{ action, label: 'Toggle playback' }],
            warning: 'togglePlayback post-commit effect failed: transport unavailable',
            receipt,
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            commitWarning: 'togglePlayback post-commit effect failed: transport unavailable',
            receipt,
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Executed: Mute vocals. Committed with follow-up warning: togglePlayback post-commit effect failed: transport unavailable',
            ['togglePlayback']
        );
    });

    it('preserves a committed result when the success notification throws', async () => {
        const receipt = idempotentReplayResult('committed').receipt;
        vi.mocked(executeVersionedCommandBatchEnvelope).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
            receipt,
        });
        vi.mocked(notifyAiChange).mockImplementation(() => {
            throw new Error('toast unavailable');
        });

        const result = await executePlannedActions({
            commandBatch,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            receipt,
            reportingWarning: 'notification: toast unavailable',
        });
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalled();
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });
});
