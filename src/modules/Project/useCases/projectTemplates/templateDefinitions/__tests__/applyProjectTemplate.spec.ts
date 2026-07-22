import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyProjectTemplate } from '../applyProjectTemplate';

const mocks = vi.hoisted(() => ({
    createPopSongTemplate: vi.fn(),
    newProject: vi.fn(),
}));

vi.mock('../../../projectPersistence/newProject', () => ({ newProject: mocks.newProject }));
vi.mock('../../templateFiles/popSong', () => ({ createPopSongTemplate: mocks.createPopSongTemplate }));

describe('applyProjectTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('runs the selected template synchronously from the action handler', async () => {
        mocks.createPopSongTemplate.mockResolvedValue(undefined);

        await expect(applyProjectTemplate('pop-song')).resolves.toBe(true);
        expect(mocks.createPopSongTemplate).toHaveBeenCalledOnce();
    });

    it('rejects unknown templates', async () => {
        await expect(applyProjectTemplate('unknown-template')).resolves.toBe(false);
    });

    it('refuses project-replacement templates inside an app-action transaction', async () => {
        await expect(applyProjectTemplate('empty')).resolves.toBe(false);

        expect(mocks.newProject).not.toHaveBeenCalled();
    });
});
