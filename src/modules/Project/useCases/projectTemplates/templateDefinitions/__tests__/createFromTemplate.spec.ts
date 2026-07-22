import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    createPopSongTemplate: vi.fn(),
    ensureTrackStrips: vi.fn(),
    executeAppAction: vi.fn(),
    isAppActionCommittedError: vi.fn(),
    newProject: vi.fn(),
    resetAudioGraph: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: mocks.resetAudioGraph,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    isAppActionCommittedError: mocks.isAppActionCommittedError,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    ensureTrackStrips: mocks.ensureTrackStrips,
    stopPlayback: mocks.stopPlayback,
}));

vi.mock('../../../projectPersistence/newProject', () => ({
    newProject: mocks.newProject,
}));

vi.mock('../../templateFiles/popSong', () => ({
    createPopSongTemplate: mocks.createPopSongTemplate,
}));

describe('createFromTemplate', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.createPopSongTemplate.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
        mocks.isAppActionCommittedError.mockReturnValue(false);
        mocks.newProject.mockResolvedValue(true);
    });

    it('rejects an unknown template before dispatch', async () => {
        const created = await createFromTemplate('unknown-template');

        expect(mocks.executeAppAction).not.toHaveBeenCalled();
        expect(created).toBe(false);
    });

    it('dispatches template construction through the action boundary', async () => {
        const created = await createFromTemplate('pop-song');

        expect(mocks.stopPlayback).toHaveBeenCalledOnce();
        expect(mocks.resetAudioGraph).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).toHaveBeenCalledWith(
            { type: 'createProjectFromTemplate', payload: { templateId: 'pop-song' } },
            { skipMacroRecording: true }
        );
        const actionOrder = mocks.executeAppAction.mock.invocationCallOrder[0];
        const resetOrder = mocks.resetAudioGraph.mock.invocationCallOrder[0];
        if (actionOrder === undefined || resetOrder === undefined) {
            throw new Error('expected reset and template action calls');
        }
        expect(actionOrder).toBeGreaterThan(resetOrder);
        expect(mocks.createPopSongTemplate).not.toHaveBeenCalled();
        expect(created).toBe(true);
    });

    it('converts a rejected template action to a failed outcome', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('device setup failed'));

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();

        const recoveryResetOrder = mocks.resetAudioGraph.mock.invocationCallOrder[1];
        const rebuildOrder = mocks.ensureTrackStrips.mock.invocationCallOrder[0];
        if (recoveryResetOrder === undefined || rebuildOrder === undefined) {
            throw new Error('expected graph recovery calls');
        }
        expect(rebuildOrder).toBeGreaterThan(recoveryResetOrder);
    });

    it('recovers when initial graph reset throws after partial teardown', async () => {
        mocks.resetAudioGraph.mockImplementationOnce(() => {
            throw new Error('partial teardown');
        });

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });

    it('keeps recovery failures inside the boolean outcome boundary', async () => {
        mocks.executeAppAction.mockRejectedValue(new Error('action failed'));
        mocks.resetAudioGraph
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('recovery reset failed');
            });
        mocks.ensureTrackStrips.mockImplementationOnce(() => {
            throw new Error('strip rebuild failed');
        });

        await expect(createFromTemplate('pop-song')).resolves.toBe(false);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('reports success when template truth committed before a degraded post-commit failure', async () => {
        const committedFailure = new Error('macro history failed after commit');
        mocks.executeAppAction.mockRejectedValue(committedFailure);
        mocks.isAppActionCommittedError.mockImplementation((error) => error === committedFailure);

        await expect(createFromTemplate('pop-song')).resolves.toBe(true);
        expect(mocks.resetAudioGraph).toHaveBeenCalledTimes(2);
        expect(mocks.ensureTrackStrips).toHaveBeenCalledOnce();
    });

    it('lets project-replacement templates own the CRDT authority swap', async () => {
        await expect(createFromTemplate('empty')).resolves.toBe(true);

        expect(mocks.newProject).toHaveBeenCalledOnce();
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
