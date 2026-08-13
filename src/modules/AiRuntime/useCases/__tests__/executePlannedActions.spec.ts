import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { executePlannedActions } from '../executePlannedActions';
import { notifyAiChange } from '../notifyAiChange';
import { recordAiActionGroup } from '../recordAiActionGroup';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn() },
}));
vi.mock('#/modules/Command/useCases', () => ({
    executeAppActionBatch: vi.fn(),
    generateGroupId: vi.fn(() => ({ groupId: 'group-1', groupLabel: 'Mute vocals' })),
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: vi.fn(),
}));
vi.mock('../notifyAiChange', () => ({ notifyAiChange: vi.fn() }));
vi.mock('../recordAiActionGroup', () => ({ recordAiActionGroup: vi.fn() }));

const action = { type: 'togglePlayback' } as const;
const runtimeAction = { type: 'setPlayback', payload: { playing: true } } as const;

describe('executePlannedActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(recordAiActionGroup).mockReset();
        vi.mocked(notifyAiChange).mockReset();
        vi.mocked(captureProjectRevision).mockReturnValue('revision-1');
    });

    it('commits the complete batch and records one truthful AI action group', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeAppActionBatch)).toHaveBeenCalledWith(
            [action],
            expect.objectContaining({
                groupId: 'group-1',
                source: 'prompt',
                requireCompensation: true,
            })
        );
        const options = vi.mocked(executeAppActionBatch).mock.calls[0]?.[1];
        expect(typeof options?.shouldExecute).toBe('function');
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
        });
    });

    it('reports a runtime-only command as executed rather than committed', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'executed',
            actions: [{ action: runtimeAction, label: 'Start playback' }],
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Start playback',
            actions: [runtimeAction],
            projectRevision: 'revision-1',
            executionMode: 'atomic',
        });

        expect(vi.mocked(executeAppActionBatch)).toHaveBeenCalledWith(
            [runtimeAction],
            expect.objectContaining({ requireCompensation: true })
        );
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
        });
    });

    it('uses executed wording when a runtime follow-up reports a warning', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'executed-with-warning',
            actions: [{ action: runtimeAction, label: 'Start playback' }],
            warning: 'setPlayback follow-up effect failed: transport unavailable',
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Start playback',
            actions: [runtimeAction],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'executed',
            actions: [{ actionType: 'setPlayback', label: 'Start playback' }],
            executionWarning: 'setPlayback follow-up effect failed: transport unavailable',
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Executed: Start playback. Executed with follow-up warning: setPlayback follow-up effect failed: transport unavailable',
            ['setPlayback']
        );
    });

    it('reports invalidation when the project revision changes before admission', async () => {
        vi.mocked(captureProjectRevision).mockReturnValue('revision-2');
        vi.mocked(executeAppActionBatch).mockImplementation((_actions, options) => {
            expect(options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({ status: 'cancelled', reason: 'authority revoked', actions: [] });
        });

        const result = await executePlannedActions({
            legacyExecution: true,
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
        vi.mocked(executeAppActionBatch).mockImplementation((_actions, options) => {
            expect(options?.shouldExecute?.()).toBe(false);
            return Promise.resolve({ status: 'cancelled', reason: 'authority revoked', actions: [] });
        });

        const result = await executePlannedActions({
            legacyExecution: true,
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
        vi.mocked(executeAppActionBatch).mockResolvedValue({ status: 'failed', reason: refusal, actions: [] });

        const result = await executePlannedActions({
            legacyExecution: true,
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
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
        });
        vi.mocked(recordAiActionGroup).mockImplementation(() => {
            throw new Error('history unavailable');
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            reportingWarning: 'history: history unavailable',
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith('Executed: Mute vocals', ['togglePlayback']);
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });

    it('distinguishes a committed post-commit effect warning from reporting failures', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'committed-with-warning',
            actions: [{ action, label: 'Toggle playback' }],
            warning: 'togglePlayback post-commit effect failed: transport unavailable',
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            commitWarning: 'togglePlayback post-commit effect failed: transport unavailable',
        });
        expect(vi.mocked(notifyAiChange)).toHaveBeenCalledWith(
            'Executed: Mute vocals. Committed with follow-up warning: togglePlayback post-commit effect failed: transport unavailable',
            ['togglePlayback']
        );
    });

    it('preserves a committed result when the success notification throws', async () => {
        vi.mocked(executeAppActionBatch).mockResolvedValue({
            status: 'committed',
            actions: [{ action, label: 'Toggle playback' }],
        });
        vi.mocked(notifyAiChange).mockImplementation(() => {
            throw new Error('toast unavailable');
        });

        const result = await executePlannedActions({
            legacyExecution: true,
            prompt: 'Mute vocals',
            actions: [action],
            projectRevision: 'revision-1',
        });

        expect(result).toEqual({
            status: 'committed',
            actions: [{ actionType: 'togglePlayback', label: 'Toggle playback' }],
            reportingWarning: 'notification: toast unavailable',
        });
        expect(vi.mocked(recordAiActionGroup)).toHaveBeenCalled();
        expect(vi.mocked(logger.error)).toHaveBeenCalled();
    });
});
