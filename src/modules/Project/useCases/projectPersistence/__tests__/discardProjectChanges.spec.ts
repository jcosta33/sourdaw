import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardProjectChanges } from '../discardProjectChanges';

const state = vi.hoisted(() => ({
    project: {
        projectId: 'original-project',
        createdAt: 10,
        dirty: true,
        identityPersistencePending: false,
    } as { projectId: string; createdAt: number; dirty: boolean; identityPersistencePending: boolean } | null,
}));
const recent = vi.hoisted(() => ({ getRecentProjects: vi.fn() }));
const snapshot = vi.hoisted(() => ({ readNamedProjectJson: vi.fn() }));
const load = vi.hoisted(() => ({ loadRecentProject: vi.fn() }));
const create = vi.hoisted(() => ({ newProject: vi.fn() }));
const crdt = vi.hoisted(() => ({ compactProject: vi.fn() }));
const notifications = vi.hoisted(() => ({ notifyUser: vi.fn() }));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return state.project;
        },
        set(next: typeof state.project) {
            state.project = next;
        },
    },
}));
vi.mock('../../recentProjects/helpers', () => recent);
vi.mock('../../../repositories/project/readNamedProjectJson', () => snapshot);
vi.mock('../../recentProjects/loadRecentProject', () => load);
vi.mock('../newProject', () => create);
vi.mock('#/modules/CrdtDocument/useCases', () => crdt);
vi.mock('#/utils/Notification/notifyUser', () => notifications);

describe('discardProjectChanges', () => {
    beforeEach(() => {
        state.project = {
            projectId: 'original-project',
            createdAt: 10,
            dirty: true,
            identityPersistencePending: false,
        };
        recent.getRecentProjects.mockReset();
        snapshot.readNamedProjectJson.mockReset();
        load.loadRecentProject.mockReset();
        create.newProject.mockReset();
        crdt.compactProject.mockReset();
        notifications.notifyUser.mockClear();
    });

    it('restores an orphaned named snapshot without consulting the recent-project index as authority', async () => {
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockResolvedValue('{"version":2}');
        load.loadRecentProject.mockImplementation(async () => {
            state.project = {
                projectId: 'original-project',
                createdAt: 10,
                dirty: false,
                identityPersistencePending: false,
            };
            return 'committed';
        });

        await expect(discardProjectChanges()).resolves.toBe(true);

        expect(load.loadRecentProject).toHaveBeenCalledWith('sourdaw:project:10');
        expect(create.newProject).not.toHaveBeenCalled();
        expect(state.project?.dirty).toBe(false);
    });

    it('replaces a never-explicitly-saved project with a clean blank project', async () => {
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockResolvedValue(null);
        create.newProject.mockImplementation(async () => {
            state.project = {
                projectId: 'replacement-project',
                createdAt: 11,
                dirty: false,
                identityPersistencePending: true,
            };
            return true;
        });
        crdt.compactProject.mockResolvedValue(undefined);

        await expect(discardProjectChanges()).resolves.toBe(true);

        expect(load.loadRecentProject).not.toHaveBeenCalled();
        expect(create.newProject).toHaveBeenCalledTimes(1);
        expect(crdt.compactProject).toHaveBeenCalledTimes(1);
        expect(state.project?.dirty).toBe(false);
        expect(state.project?.identityPersistencePending).toBe(false);
    });

    it('fails closed when a stale recent entry points to a missing named snapshot', async () => {
        recent.getRecentProjects.mockReturnValue([{ key: 'sourdaw:project:10', name: 'Saved song', updatedAt: 1 }]);
        snapshot.readNamedProjectJson.mockResolvedValue(null);

        await expect(discardProjectChanges()).resolves.toBe(false);

        expect(state.project?.dirty).toBe(true);
        expect(load.loadRecentProject).not.toHaveBeenCalled();
        expect(create.newProject).not.toHaveBeenCalled();
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            'The last saved project snapshot is unavailable. Your changes were not discarded.',
            'error'
        );
    });

    it('denies close when the replacement project cannot be compacted a second time', async () => {
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockResolvedValue(null);
        create.newProject.mockImplementation(async () => {
            state.project = {
                projectId: 'replacement-project',
                createdAt: 11,
                dirty: false,
                identityPersistencePending: true,
            };
            return true;
        });
        crdt.compactProject.mockRejectedValue(new Error('persistence unavailable'));

        await expect(discardProjectChanges()).resolves.toBe(false);

        expect(state.project?.identityPersistencePending).toBe(true);
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            'The replacement project could not be persisted. Reload Sourdaw to recover it; close was cancelled.',
            'error'
        );
    });
});
