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
const crdt = vi.hoisted(() => ({ compactProject: vi.fn(), captureProjectRevision: vi.fn(() => 'revision-1') }));
const notifications = vi.hoisted(() => ({ notifyUser: vi.fn() }));
const transitionAuthority = vi.hoisted(() => ({ current: true }));

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
vi.mock('../captureProjectTransitionAuthority', () => ({
    captureProjectTransitionAuthority: () => ({ isCurrent: () => transitionAuthority.current }),
}));
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
        crdt.captureProjectRevision.mockReset();
        crdt.captureProjectRevision.mockReturnValue('revision-1');
        notifications.notifyUser.mockClear();
        transitionAuthority.current = true;
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

        expect(load.loadRecentProject).toHaveBeenCalledWith('sourdaw:project:10', { requireDurable: true });
        expect(create.newProject).not.toHaveBeenCalled();
        expect(state.project?.dirty).toBe(false);
    });

    it('fails closed when a newer project edit takes ownership while the snapshot read is pending', async () => {
        let resolveSnapshot: ((value: string | null) => void) | undefined;
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockImplementation(
            () =>
                new Promise<string | null>((resolve) => {
                    resolveSnapshot = resolve;
                })
        );

        const discard = discardProjectChanges();
        state.project = {
            // The same identity is not enough: the later edit is a new store
            // publication and must not be discarded by the stale request.
            projectId: 'original-project',
            createdAt: 10,
            dirty: true,
            identityPersistencePending: false,
        };
        transitionAuthority.current = false;
        resolveSnapshot?.('{"version":2}');

        await expect(discard).resolves.toBe(false);
        expect(load.loadRecentProject).not.toHaveBeenCalled();
        expect(create.newProject).not.toHaveBeenCalled();
        expect(state.project?.dirty).toBe(true);
    });

    it('fails closed when CRDT truth changes without republishing an already-dirty project', async () => {
        let resolveSnapshot: ((value: string | null) => void) | undefined;
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockImplementation(
            () =>
                new Promise<string | null>((resolve) => {
                    resolveSnapshot = resolve;
                })
        );

        const discard = discardProjectChanges();
        // `markDirty` short-circuits for an already-dirty project, so its
        // metadata object and load authority legitimately remain unchanged.
        crdt.captureProjectRevision.mockReturnValue('revision-after-edit');
        resolveSnapshot?.('{"version":2}');

        await expect(discard).resolves.toBe(false);
        expect(load.loadRecentProject).not.toHaveBeenCalled();
        expect(create.newProject).not.toHaveBeenCalled();
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

    it('accepts an already durable clean replacement without a second compaction', async () => {
        recent.getRecentProjects.mockReturnValue([]);
        snapshot.readNamedProjectJson.mockResolvedValue(null);
        create.newProject.mockImplementation(async () => {
            state.project = {
                projectId: 'replacement-project',
                createdAt: 11,
                dirty: false,
                identityPersistencePending: false,
            };
            return true;
        });
        crdt.compactProject.mockRejectedValue(new Error('must not be called'));

        await expect(discardProjectChanges()).resolves.toBe(true);

        expect(crdt.compactProject).not.toHaveBeenCalled();
    });

    it('fails closed when the replacement changes during the required compaction', async () => {
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
        crdt.compactProject.mockImplementation(async () => {
            state.project = {
                projectId: 'newer-project',
                createdAt: 12,
                dirty: false,
                identityPersistencePending: false,
            };
        });

        await expect(discardProjectChanges()).resolves.toBe(false);

        expect(notifications.notifyUser).toHaveBeenCalledWith(
            'The replacement project changed before it was persisted. Reload Sourdaw to recover it; close was cancelled.',
            'error'
        );
    });
});
