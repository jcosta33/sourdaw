import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { consumeCommandApprovalBinding } from '../consumeCommandApprovalBinding';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';
import { issueCommandApprovalBinding } from '../issueCommandApprovalBinding';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

function compileCommitBatch(
    gain = 0.8,
    autoCommit = false,
    autoCommitApproval?: Parameters<typeof compileVersionedCommandBatchEnvelope>[0]['autoCommitApproval']
) {
    const action: SetTrackGainAction = {
        type: 'setTrackGain',
        payload: { expectedGain: 1, gain, trackId: 'track-vocal' },
    };
    const command = {
        ...createExecutionCommandEnvelope({
            action,
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        }).envelope,
        commandId: '11111111-1111-4111-8111-111111111111',
    };
    const resolvedAutoCommitApproval = autoCommit
        ? (autoCommitApproval ?? (() => ({ status: 'valid' as const })))
        : undefined;
    return compileVersionedCommandBatchEnvelope({
        autoCommit,
        autoCommitApproval: resolvedAutoCommitApproval,
        baseRevision: 'revision-1',
        batchId: 'batch-approval-boundary',
        commands: [JSON.stringify(command)],
        intent: 'Set vocal gain',
        mode: 'commit',
        projectId: 'project-approval-boundary',
        runId: 'run-approval-boundary',
    });
}

function setupCommitBoundary() {
    const execute = vi.fn(() => ({ status: 'written' as const }));
    registerHandlerMap({
        setTrackGain: {
            canReapplyAfterDivergence: () => true,
            describe: () => ({
                inverseAction: {
                    type: 'setTrackGain',
                    payload: { expectedGain: 0.8, gain: 1, trackId: 'track-vocal' },
                },
                label: 'Set vocal gain',
            }),
            execute,
            undoable: true,
            validate: () => true,
        } satisfies ActionHandler<SetTrackGainAction>,
    });
    commandProjectRevisionPort.setProvider(() => 'revision-1');
    commandBatchPreflightPort.setProvider(() => ({
        audioGraphValid: true,
        availableAssetHashes: [],
        availableAudioBufferIds: [],
        lockedRanges: [],
        projectId: 'project-approval-boundary',
        projectInvariantsValid: true,
        targetFingerprints: { 'track-vocal': 'track-vocal:v1' },
    }));
    return execute;
}

describe('command approval boundary', () => {
    afterEach(() => {
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
    });

    it('rejects a bare confirmation boolean before the first handler', async () => {
        const execute = setupCommitBoundary();
        const batch = compileCommitBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Commit batch requires an exact approval binding',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('revalidates and consumes an exact binding immediately before the first handler', async () => {
        const execute = setupCommitBoundary();
        const batch = compileCommitBatch();
        const validate = vi.fn(() => ({ status: 'valid' as const }));
        const approvalBinding = issueCommandApprovalBinding({ ...batch, validate });

        const result = await executeVersionedCommandBatchEnvelope({ ...batch, approvalBinding });

        expect(result.status).toBe('committed');
        expect(validate).toHaveBeenCalledOnce();
        expect(execute).toHaveBeenCalledOnce();

        const repeated = await executeVersionedCommandBatchEnvelope({ ...batch, approvalBinding });
        expect(repeated).toMatchObject({
            status: 'rejected',
            reason: 'Command approval binding was already consumed',
        });
        expect(execute).toHaveBeenCalledOnce();
    });

    it('routes application-authorized auto-commit through the same exact binding', async () => {
        const execute = setupCommitBoundary();
        const batch = compileCommitBatch(0.8, true);

        expect(batch.approvalBinding).toBeDefined();
        const result = await executeVersionedCommandBatchEnvelope(batch);

        expect(result.status).toBe('committed');
        expect(execute).toHaveBeenCalledOnce();
    });

    it('revalidates producer-owned auto-commit policy before the first handler', async () => {
        const execute = setupCommitBoundary();
        const batch = compileCommitBatch(0.8, true, () => ({
            status: 'invalid',
            reason: 'The producer trust ceiling changed.',
        }));

        const result = await executeVersionedCommandBatchEnvelope(batch);

        expect(result).toMatchObject({ status: 'rejected', reason: 'The producer trust ceiling changed.' });
        expect(execute).not.toHaveBeenCalled();
    });

    it('makes approval consumption atomic against reentrant validation', async () => {
        const execute = setupCommitBoundary();
        const batch = compileCommitBatch();
        let nestedResult: ReturnType<typeof consumeCommandApprovalBinding> | undefined;
        const approvalBinding = issueCommandApprovalBinding({
            ...batch,
            validate: () => {
                nestedResult = consumeCommandApprovalBinding({ ...batch, approvalBinding });
                return { status: 'valid' };
            },
        });

        const result = await executeVersionedCommandBatchEnvelope({ ...batch, approvalBinding });

        expect(result.status).toBe('committed');
        expect(nestedResult).toEqual({ status: 'invalid', reason: 'Command approval binding was already consumed' });
        expect(execute).toHaveBeenCalledOnce();
    });

    it('rejects stale or substituted approval before any handler', async () => {
        const execute = setupCommitBoundary();
        const approvedBatch = compileCommitBatch();
        const substitutedBatch = compileCommitBatch(0.7);
        const exactBinding = issueCommandApprovalBinding({
            ...approvedBatch,
            validate: () => ({ status: 'valid' }),
        });

        const substituted = await executeVersionedCommandBatchEnvelope({
            ...substitutedBatch,
            approvalBinding: exactBinding,
        });
        expect(substituted).toMatchObject({
            status: 'rejected',
            reason: 'Command approval binding does not match the exact command batch',
        });
        expect(execute).not.toHaveBeenCalled();

        const staleBinding = issueCommandApprovalBinding({
            ...approvedBatch,
            validate: () => ({ status: 'invalid', reason: 'The approved source revision is stale.' }),
        });
        const stale = await executeVersionedCommandBatchEnvelope({ ...approvedBatch, approvalBinding: staleBinding });
        expect(stale).toMatchObject({ status: 'rejected', reason: 'The approved source revision is stale.' });
        expect(execute).not.toHaveBeenCalled();
    });
});
