import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loadProject } from '../projectPersistence/loadProject';
import { renameProject } from '../projectPersistence/saveProject/renameProject';
import { saveProject } from '../projectPersistence/saveProject/saveProject';

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

// Mock the dependencies of the use cases we are testing
vi.mock('../../stores/projectStore', () => ({
    projectStore: {
        get value() {
            return mocks.projectStoreValue.value;
        },
        set: mocks.projectStoreSet,
    },
}));

// For saveProject.ts (nested two levels down from projectPersistence/)
// it imports from ../../../stores/projectStore which is correct.
// But when we test it from __tests__/, it's different.
// Vitest mocks should use the same path as the import in the source file.

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: mocks.createCrdtProject,
    loadCrdtProject: mocks.loadCrdtProject,
    projectCrdtToStores: mocks.projectCrdtToStores,
    startCrdtAutoSave: mocks.startCrdtAutoSave,
    persistCrdtProject: mocks.persistCrdtProject,
}));

vi.mock('#/modules/Command/stores', () => ({
    clearUndoHistory: mocks.clearUndoHistory,
}));

// Relative to saveProject.ts: ../../recentProjects/addToRecentProjects
vi.mock('../recentProjects/addToRecentProjects', () => ({
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
    });

    describe('saveProject', () => {
        it('persists CRDT and updates store metadata', async () => {
            mocks.projectStoreValue.value = { name: 'My Song', dirty: true } as any;

            saveProject();

            expect(mocks.persistCrdtProject).toHaveBeenCalled();
            expect(mocks.addToRecentProjects).toHaveBeenCalledWith('My Song', 'sourdaw:project:My Song');

            await vi.waitFor(() => {
                expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
            });
        });
    });

    describe('renameProject', () => {
        it('updates name and marks dirty', () => {
            renameProject('New Name');
            expect(mocks.projectStoreSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: 'New Name',
                    dirty: true,
                })
            );
        });
    });
});
