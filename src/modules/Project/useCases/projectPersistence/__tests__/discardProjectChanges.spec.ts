import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardProjectChanges } from '../discardProjectChanges';

const state = vi.hoisted(() => ({
    project: { createdAt: 10, dirty: true } as { createdAt: number; dirty: boolean } | null,
}));
const recent = vi.hoisted(() => ({ getRecentProjects: vi.fn() }));
const load = vi.hoisted(() => ({ loadRecentProject: vi.fn() }));
const create = vi.hoisted(() => ({ newProject: vi.fn() }));
const notifications = vi.hoisted(() => ({ notifyUser: vi.fn() }));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return state.project;
        },
    },
}));
vi.mock('../../recentProjects/helpers', () => recent);
vi.mock('../../recentProjects/loadRecentProject', () => load);
vi.mock('../newProject', () => create);
vi.mock('#/utils/Notification/notifyUser', () => notifications);

describe('discardProjectChanges', () => {
    beforeEach(() => {
        state.project = { createdAt: 10, dirty: true };
        recent.getRecentProjects.mockReset();
        load.loadRecentProject.mockReset();
        create.newProject.mockReset();
        notifications.notifyUser.mockClear();
    });

    it('restores the active project from its explicit named snapshot without saving current edits', async () => {
        recent.getRecentProjects.mockReturnValue([{ key: 'sourdaw:project:10', name: 'Saved song', updatedAt: 1 }]);
        load.loadRecentProject.mockImplementation(async () => {
            state.project = { createdAt: 10, dirty: false };
            return 'committed';
        });

        await expect(discardProjectChanges()).resolves.toBe(true);

        expect(load.loadRecentProject).toHaveBeenCalledWith('sourdaw:project:10');
        expect(create.newProject).not.toHaveBeenCalled();
        expect(state.project?.dirty).toBe(false);
    });

    it('replaces a never-explicitly-saved project with a clean blank project', async () => {
        recent.getRecentProjects.mockReturnValue([]);
        create.newProject.mockImplementation(async () => {
            state.project = { createdAt: 11, dirty: false };
            return true;
        });

        await expect(discardProjectChanges()).resolves.toBe(true);

        expect(load.loadRecentProject).not.toHaveBeenCalled();
        expect(create.newProject).toHaveBeenCalledTimes(1);
        expect(state.project?.dirty).toBe(false);
    });

    it('fails closed and notifies when the named snapshot cannot be restored', async () => {
        recent.getRecentProjects.mockReturnValue([{ key: 'sourdaw:project:10', name: 'Saved song', updatedAt: 1 }]);
        load.loadRecentProject.mockResolvedValue('failed');

        await expect(discardProjectChanges()).resolves.toBe(false);

        expect(state.project?.dirty).toBe(true);
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            'Could not restore the last saved project state. Your changes were not discarded.',
            'error'
        );
    });
});
