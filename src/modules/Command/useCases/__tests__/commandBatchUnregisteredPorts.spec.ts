import { describe, expect, it, vi } from 'vitest';

import { registerHandlerMap } from '#/modules/Command/stores';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { COMMAND_BATCH_IDEMPOTENCY_REGISTRAR } from '../../testing/registerInMemoryCommandBatchIdempotency';
import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { getVersionedCommandBatchIdempotentReplay } from '../getVersionedCommandBatchIdempotentReplay';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

const execute = vi.fn(() => ({ status: 'written' as const }));

function compileBatch() {
    const baseRevision = JSON.stringify({
        documentIdentityEpoch: 1,
        mutationEpoch: 0,
        documents: [{ docId: 'root', heads: ['head-0'] }],
    });
    const action: SetTrackGainAction = {
        type: 'setTrackGain',
        payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
    };
    const command = {
        ...createExecutionCommandEnvelope({
            action,
            expectedEffect: 'Set the vocal gain to 0.8.',
            normalizedProjectRevision: baseRevision,
        }).envelope,
        commandId: '11111111-1111-4111-8111-111111111111',
    };
    return compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: 'batch-unregistered-ports',
        commands: [JSON.stringify(command)],
        idempotencyKey: 'client-request-unregistered-ports',
        intent: 'Set vocal gain',
        mode: 'commit',
        projectId: 'project-unregistered-ports',
        runId: 'run-unregistered-ports',
    });
}

function createHandler(): ActionHandler<SetTrackGainAction> {
    return {
        canReapplyAfterDivergence: () => true,
        describe: () => ({
            inverseAction: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
            },
            label: 'Set vocal gain',
        }),
        execute,
        previewExecution: 'isolated-project',
        undoable: true,
        validate: () => true,
    };
}

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: nothing is registered at first, then only the execution authority.
describe('a batch run with its idempotency ports unregistered', () => {
    it('throws naming the registrar when the execution authority is unregistered', async () => {
        registerHandlerMap({ setTrackGain: createHandler() });
        const batch = compileBatch();

        await expect(
            executeApprovedVersionedCommandBatchEnvelope({
                authority: batch.authority,
                confirmed: true,
                serialized: batch.serialized,
            })
        ).rejects.toThrow(COMMAND_BATCH_IDEMPOTENCY_REGISTRAR);
        expect(execute).not.toHaveBeenCalled();
    });

    it('refuses to execute the same approved batch twice and names the registrar when no repository is registered', async () => {
        commandBatchExecutionAuthorityPort.setProvider(() => true);
        const batch = compileBatch();
        const input = { authority: batch.authority, confirmed: true, serialized: batch.serialized };

        const first = await executeApprovedVersionedCommandBatchEnvelope(input);
        const second = await executeApprovedVersionedCommandBatchEnvelope(input);

        for (const result of [first, second]) {
            expect(result).toMatchObject({ status: 'rejected' });
            expect('reason' in result ? result.reason : '').toContain(COMMAND_BATCH_IDEMPOTENCY_REGISTRAR);
        }
        expect(execute).not.toHaveBeenCalled();
    });

    it('throws naming the registrar when asked for a prior receipt with no repository registered', async () => {
        const batch = compileBatch();

        await expect(
            getVersionedCommandBatchIdempotentReplay({ authority: batch.authority, serialized: batch.serialized })
        ).rejects.toThrow(COMMAND_BATCH_IDEMPOTENCY_REGISTRAR);
    });
});
