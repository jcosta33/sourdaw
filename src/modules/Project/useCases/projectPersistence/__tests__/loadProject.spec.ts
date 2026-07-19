import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';

import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, initialized: true } as ProjectStoreState },
    projectStoreSet: vi.fn(),
    createCrdtProject: vi.fn(),
    getCrdtDoc: vi.fn(() => ({ tracks: { tracks: [] } })),
    loadCrdtProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    prepareCachedAudioBuffersFromIdb: vi.fn(() => Promise.resolve({ publish: vi.fn() })),
    resetModuleStores: vi.fn(),
    stopActiveAutoSave: vi.fn(),
    setAutoSaveHandle: vi.fn(),
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelPendingAudioBufferImport: vi.fn(),
    getAudioContext: vi.fn(() => ({})),
    prepareCachedAudioBuffersFromIdb: mocks.prepareCachedAudioBuffersFromIdb,
}));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({ migrateAbsoluteMidiNotes: vi.fn() }));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({ resetModuleStoresToDefault: mocks.resetModuleStores }));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: mocks.stopActiveAutoSave }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: mocks.setAutoSaveHandle }));

describe('loadProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = { loading: false, initialized: true } as ProjectStoreState;
        mocks.loadCrdtProject.mockResolvedValue(true);
        mocks.createCrdtProject.mockResolvedValue(undefined);
        mocks.prepareCachedAudioBuffersFromIdb.mockResolvedValue({ publish: vi.fn() });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it('should hydrate only after collaboration exits and persistence activates', async () => {
        await expect(loadProject()).resolves.toBe(true);

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(mocks.resetModuleStores).toHaveBeenCalledWith({
            resetGrooveTemplates: false,
            resetYeastState: false,
        });
        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('lands on the launch screen without creating a document when persistence is empty', async () => {
        mocks.loadCrdtProject.mockResolvedValue(false);

        await expect(loadProject()).resolves.toBe(false);

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        // Loading is cleared so AppShell can present the LaunchScreen.
        expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ loading: false }));
    });

    it('should preserve the current project when persistence loading fails', async () => {
        const failure = new Error('sanitization failed');
        mocks.loadCrdtProject.mockRejectedValue(failure);

        await expect(loadProject()).rejects.toBe(failure);

        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(clearUndoHistory).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(projectStore.set).not.toHaveBeenCalled();
    });

    it('should ignore an older load that resolves after a newer load', async () => {
        let resolveFirst: ((loaded: boolean) => void) | undefined;
        let resolveSecond: ((loaded: boolean) => void) | undefined;
        mocks.loadCrdtProject
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolveSecond = resolve;
                    })
            );

        const first = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(1));
        const second = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(2));
        resolveSecond?.(true);
        await expect(second).resolves.toBe(true);
        resolveFirst?.(true);
        await expect(first).resolves.toBe(false);

        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('should abort before repository load when collaboration shutdown fails', async () => {
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () => Promise.reject(new Error('shutdown failed')),
        });

        await expect(loadProject()).resolves.toBe(false);

        expect(loadCrdtProject).not.toHaveBeenCalled();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
    });
});
