import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyProjectTemplate } from '../applyProjectTemplate';

const mocks = vi.hoisted(() => ({ createPopSongTemplate: vi.fn(), newProject: vi.fn() }));

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

    it('propagates empty-project activation failure and rejects unknown templates', async () => {
        mocks.newProject.mockResolvedValue(false);

        await expect(applyProjectTemplate('empty')).resolves.toBe(false);
        await expect(applyProjectTemplate('unknown-template')).resolves.toBe(false);
    });
});
