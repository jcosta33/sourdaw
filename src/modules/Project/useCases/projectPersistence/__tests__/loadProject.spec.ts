import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory, clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';

import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { loadProject } from '../loadProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

const module_mocks = vi.hoisted(() => ({
    project_store_value: { value: { loading: false, initialized: true } as ProjectStoreState },
    project_store_set: vi.fn(),
    reset_module_stores: vi.fn(),
    stop_active_auto_save: vi.fn(),
    set_auto_save_handle: vi.fn(),
}));

vi.mock('../../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return module_mocks.project_store_value.value;
        },
        set: module_mocks.project_store_set,
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: vi.fn(),
    loadCrdtProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
}));
vi.mock('#/modules/Command/useCases', () => ({
    clearActionHistory: vi.fn(),
    clearUndoHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({ migrateAbsoluteMidiNotes: vi.fn() }));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: module_mocks.reset_module_stores,
}));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: module_mocks.stop_active_auto_save }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: module_mocks.set_auto_save_handle }));

describe('loadProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(clearActionHistory).mockReset();
        module_mocks.project_store_value.value = { loading: false, initialized: true } as ProjectStoreState;
        vi.mocked(loadCrdtProject).mockResolvedValue(true);
        vi.mocked(createCrdtProject).mockResolvedValue(true);
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
    });

    it('should complete target scrub before hydration and normal use', async () => {
        await loadProject();

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(clearActionHistory).toHaveBeenCalledTimes(1);
        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        expect(vi.mocked(clearActionHistory).mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.reset_module_stores.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(vi.mocked(clearActionHistory).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(projectCrdtToStores).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(vi.mocked(clearActionHistory).mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.project_store_set.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should create a replacement document when persistence is empty', async () => {
        vi.mocked(loadCrdtProject).mockResolvedValue(false);

        await loadProject();

        expect(createCrdtProject).toHaveBeenCalledWith({
            name: 'Untitled Project',
            canActivate: expect.any(Function),
        });
        expect(clearActionHistory).toHaveBeenCalledTimes(1);
    });

    it('should abort hydration and autosave when target scrub fails', async () => {
        const failure = new Error('target history scrub failed');
        vi.mocked(clearActionHistory).mockImplementation(() => {
            throw failure;
        });

        await expect(loadProject()).rejects.toBe(failure);

        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(clearUndoHistory).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(module_mocks.set_auto_save_handle).not.toHaveBeenCalled();
        expect(projectStore.set).not.toHaveBeenCalled();
    });

    it('should ignore an older load that resolves after a newer load', async () => {
        let resolve_first: ((loaded: boolean) => void) | undefined;
        let resolve_second: ((loaded: boolean) => void) | undefined;
        vi.mocked(loadCrdtProject)
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolve_first = resolve;
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        resolve_second = resolve;
                    })
            );

        const first = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(1));
        const second = loadProject();
        await vi.waitFor(() => expect(loadCrdtProject).toHaveBeenCalledTimes(2));
        resolve_second?.(true);
        await expect(second).resolves.toBe(true);
        resolve_first?.(true);
        await expect(first).resolves.toBe(false);

        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        expect(clearActionHistory).toHaveBeenCalledTimes(1);
    });

    it('should abort before repository load when collaboration shutdown fails', async () => {
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: async () => {
                throw new Error('shutdown failed');
            },
        });

        await expect(loadProject()).resolves.toBe(false);

        expect(loadCrdtProject).not.toHaveBeenCalled();
        expect(createCrdtProject).not.toHaveBeenCalled();
        expect(projectCrdtToStores).not.toHaveBeenCalled();
    });
});
