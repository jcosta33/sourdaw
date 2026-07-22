import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    createPopSongTemplate: vi.fn(),
    executeAppAction: vi.fn(),
    newProject: vi.fn(),
    resetAudioGraph: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: mocks.resetAudioGraph,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('#/modules/Transport/useCases', () => ({
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
        vi.clearAllMocks();
        mocks.createPopSongTemplate.mockResolvedValue(undefined);
        mocks.executeAppAction.mockResolvedValue(undefined);
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
        expect(mocks.executeAppAction).toHaveBeenCalledWith({
            type: 'createProjectFromTemplate',
            payload: { templateId: 'pop-song' },
        });
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
    });

    it('lets project-replacement templates own the CRDT authority swap', async () => {
        await expect(createFromTemplate('empty')).resolves.toBe(true);

        expect(mocks.newProject).toHaveBeenCalledOnce();
        expect(mocks.executeAppAction).not.toHaveBeenCalled();
    });
});
