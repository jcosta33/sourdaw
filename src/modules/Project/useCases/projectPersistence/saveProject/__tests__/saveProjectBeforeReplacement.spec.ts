import { describe, it, expect, vi, beforeEach } from 'vitest';

import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { projectLoadFailureStore } from '../../../../stores/projectLoadFailureStore';
import { saveProjectBeforeReplacement } from '../saveProjectBeforeReplacement';

type OpenProject = { createdAt: number; dirty: boolean; loading: boolean; name: string };

const mocks = vi.hoisted(() => ({
    saveProject: vi.fn<() => Promise<boolean>>(),
    projectStoreValue: { value: null as OpenProject | null },
    identity: { value: 'identity-a' },
}));

vi.mock('../saveProject', () => ({ saveProject: mocks.saveProject }));
vi.mock('../../../../stores/projectStore', () => ({ projectStore: mocks.projectStoreValue }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectIdentity: vi.fn(() => mocks.identity.value),
}));
vi.mock('#/utils/Notification/confirmUser', () => ({ confirmUser: vi.fn() }));

const openProject = (overrides: Partial<OpenProject> = {}): OpenProject => ({
    createdAt: 1,
    dirty: true,
    loading: false,
    name: 'Night Session',
    ...overrides,
});

describe('saveProjectBeforeReplacement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = null;
        mocks.identity.value = 'identity-a';
        projectLoadFailureStore.set(null);
        vi.mocked(confirmUser).mockResolvedValue(true);
    });

    // After a failed load the store still names a project whose session is
    // gone, and saveProject refuses early. Discarding there would compact over
    // the copy a reload restores, so the refusal stands without a question.
    it('stays without asking when a project load has failed', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Night Session' });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('stays without asking while a project load is in flight', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject({ loading: true });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('stays without asking when no project is open and the save fails', async () => {
        mocks.saveProject.mockResolvedValue(false);

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('stays when a load starts while the dialog is up', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockImplementation(() => {
            mocks.projectStoreValue.value = openProject({ loading: true });
            return Promise.resolve(true);
        });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
    });

    it('proceeds saving closed takes, without asking, when the save succeeds and the project is clean', async () => {
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = openProject({ dirty: false });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('save-closed-takes');
        expect(mocks.saveProject).toHaveBeenCalledTimes(1);
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('proceeds without an open project — there is nothing to destroy', async () => {
        mocks.saveProject.mockResolvedValue(true);

        await expect(saveProjectBeforeReplacement()).resolves.toBe('save-closed-takes');
        expect(confirmUser).not.toHaveBeenCalled();
    });

    // A project whose save keeps failing must not trap the user: every DAW
    // answers a failed save-before-close with Don't Save or Cancel.
    it("offers Don't Save, naming the project, when the pre-switch save fails", async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockResolvedValue(true);

        await expect(saveProjectBeforeReplacement()).resolves.toBe('discard');
        expect(mocks.saveProject).toHaveBeenCalledTimes(1);
        expect(confirmUser).toHaveBeenCalledTimes(1);
        expect(confirmUser).toHaveBeenCalledWith(
            expect.objectContaining({
                title: expect.stringContaining('Night Session'),
                confirmLabel: "Don't Save",
                cancelLabel: 'Cancel',
                variant: 'danger',
            })
        );
    });

    it('stays when the user cancels after a failed save', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockResolvedValue(false);

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    });

    // Issue 3694: a save can resolve true while the project is still dirty —
    // a plugin state capture rejected before commit warns the user, leaves
    // that edit out of the persisted truth, and holds the dirty flag so the
    // next save retries. Replacing the project over it would destroy the
    // edit, so the user is asked exactly as after a failed save.
    it('asks when the save resolves but the project is still dirty', async () => {
        mocks.saveProject.mockResolvedValue(true);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        await expect(saveProjectBeforeReplacement()).resolves.toBe('discard');
        expect(confirmUser).toHaveBeenCalledTimes(2);
    });

    it('stays when another project opened while the dialog was up', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockImplementation(() => {
            mocks.projectStoreValue.value = openProject({ createdAt: 2, dirty: false, name: 'Other' });
            mocks.identity.value = 'identity-b';
            return Promise.resolve(true);
        });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
        expect(captureProjectIdentity).toHaveBeenCalled();
    });

    it('stays when the document identity moved while the dialog was up', async () => {
        mocks.saveProject.mockResolvedValue(false);
        mocks.projectStoreValue.value = openProject();
        vi.mocked(confirmUser).mockImplementation(() => {
            mocks.identity.value = 'identity-b';
            return Promise.resolve(true);
        });

        await expect(saveProjectBeforeReplacement()).resolves.toBe('stay');
    });
});
