import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFromTemplate } from '../createFromTemplate';

const mocks = vi.hoisted(() => ({
    createPopSongTemplate: vi.fn(),
    newProject: vi.fn(),
    resetAudioGraph: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    resetAudioGraph: mocks.resetAudioGraph,
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
        mocks.newProject.mockResolvedValue(true);
    });

    it('propagates an empty-template activation failure', async () => {
        mocks.newProject.mockResolvedValue(false);

        const created = await createFromTemplate('empty');

        expect(mocks.newProject).toHaveBeenCalledWith('Untitled');
        expect(created).toBe(false);
    });

    it('reports successful completion for an existing project template', async () => {
        const created = await createFromTemplate('pop-song');

        expect(mocks.createPopSongTemplate).toHaveBeenCalledTimes(1);
        expect(created).toBe(true);
    });
});
