import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';

import { projectStore, type ProjectStoreState } from '../../../stores/projectStore';
import { beginProjectIdentityTransition } from '../beginProjectIdentityTransition';
import { loadProject } from '../loadProject';

const module_mocks = vi.hoisted(() => ({
    project_store_value: { value: { loading: false, initialized: true } as ProjectStoreState },
    project_store_set: vi.fn(),
    complete_transition: vi.fn<() => void>(),
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
vi.mock('#/modules/Command/useCases', () => ({ clearUndoHistory: vi.fn() }));
vi.mock('#/modules/MIDI/useCases', () => ({ migrateAbsoluteMidiNotes: vi.fn() }));
vi.mock('../beginProjectIdentityTransition', () => ({
    beginProjectIdentityTransition: vi.fn(() => module_mocks.complete_transition),
}));
vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: module_mocks.reset_module_stores,
}));
vi.mock('../helpers/stopActiveAutoSave', () => ({ stopActiveAutoSave: module_mocks.stop_active_auto_save }));
vi.mock('../helpers/autoSaveHandle', () => ({ setAutoSaveHandle: module_mocks.set_auto_save_handle }));

describe('loadProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        module_mocks.project_store_value.value = { loading: false, initialized: true } as ProjectStoreState;
        vi.mocked(loadCrdtProject).mockResolvedValue(true);
    });

    it('should complete target scrub before hydration and normal use', async () => {
        await loadProject();

        expect(beginProjectIdentityTransition).toHaveBeenCalledTimes(1);
        expect(module_mocks.complete_transition).toHaveBeenCalledTimes(1);
        expect(projectCrdtToStores).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
        expect(module_mocks.complete_transition.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.reset_module_stores.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(module_mocks.complete_transition.mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(projectCrdtToStores).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
        expect(module_mocks.complete_transition.mock.invocationCallOrder[0]).toBeLessThan(
            module_mocks.project_store_set.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('should create a replacement document when persistence is empty', async () => {
        vi.mocked(loadCrdtProject).mockResolvedValue(false);

        await loadProject();

        expect(createCrdtProject).toHaveBeenCalledWith('Untitled Project');
        expect(module_mocks.complete_transition).toHaveBeenCalledTimes(1);
    });

    it('should abort hydration and autosave when target scrub fails', async () => {
        const failure = new Error('target history scrub failed');
        module_mocks.complete_transition.mockImplementation(() => {
            throw failure;
        });

        await expect(loadProject()).rejects.toBe(failure);

        expect(projectCrdtToStores).not.toHaveBeenCalled();
        expect(clearUndoHistory).not.toHaveBeenCalled();
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(module_mocks.set_auto_save_handle).not.toHaveBeenCalled();
        expect(projectStore.set).not.toHaveBeenCalled();
    });
});
