import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadProject } from '../projectPersistence/loadProject';
import { saveProject } from '../projectPersistence/saveProject/saveProject';
import { renameProject } from '../projectPersistence/saveProject/renameProject';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, dirty: false, name: 'Initial' } },
    projectStoreSet: vi.fn(),
    createCrdtProject: vi.fn(),
    loadCrdtProject: vi.fn(),
    projectCrdtToStores: vi.fn(),
    startCrdtAutoSave: vi.fn(() => vi.fn()),
    clearUndoHistory: vi.fn(),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
    addToRecentProjects: vi.fn(),
}));

vi.mock('../../stores/projectStore', () => ({
    projectStore: {
        get value() { return mocks.projectStoreValue.value; },
        set: mocks.projectStoreSet,
    }
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearUndoHistory: mocks.clearUndoHistory,
}));

vi.mock('../../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

describe('Project Persistence Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = { loading: false, dirty: false, name: 'Initial' } as any;
    });

    describe('loadProject', () => {
        it('sets loading flag, loads CRDT, and hydrates stores', async () => {
            mocks.loadCrdtProject.mockResolvedValue(true);

            await loadProject();

            expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ loading: true }));
            expect(mocks.loadCrdtProject).toHaveBeenCalled();
            expect(mocks.projectCrdtToStores).toHaveBeenCalled();
            expect(mocks.clearUndoHistory).toHaveBeenCalled();
            expect(mocks.startCrdtAutoSave).toHaveBeenCalled();
        });

        it('creates new project if load fails', async () => {
            mocks.loadCrdtProject.mockResolvedValue(false);

            await loadProject();

            expect(mocks.createCrdtProject).toHaveBeenCalledWith('Untitled Project');
        });
    });

    describe('saveProject', () => {
        it('persists CRDT and updates store metadata', async () => {
            mocks.projectStoreValue.value = { name: 'My Song', dirty: true } as any;

            saveProject();

            expect(mocks.persistCrdtProject).toHaveBeenCalled();
            // addToRecentProjects is called synchronously after starting the persist promise
            expect(mocks.addToRecentProjects).toHaveBeenCalledWith('My Song', 'sourdaw:project:My Song');

            await vi.waitFor(() => {
                expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
            });
        });
    });

    describe('renameProject', () => {
        it('updates name and marks dirty', () => {
            renameProject('New Name');
            expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({
                name: 'New Name',
                dirty: true,
            }));
        });
    });
});
