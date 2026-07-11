import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renameProject } from '../projectPersistence/saveProject/renameProject';
import { saveProject } from '../projectPersistence/saveProject/saveProject';

import type { ProjectStoreState } from '../../stores/projectStore';

const mocks = vi.hoisted(() => ({
    projectStoreValue: { value: { loading: false, dirty: false, name: 'Initial' } as unknown as ProjectStoreState },
    projectStoreSet: vi.fn<(...args: unknown[]) => void>(),
    persistCrdtProject: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    addToRecentProjects: vi.fn<(...args: unknown[]) => void>(),
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
    persistCrdtProject: mocks.persistCrdtProject,
}));

// Relative to saveProject.ts: ../../recentProjects/addToRecentProjects
vi.mock('../recentProjects/addToRecentProjects', () => ({
    addToRecentProjects: mocks.addToRecentProjects,
}));

describe('Project Persistence Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.projectStoreValue.value = {
            loading: false,
            dirty: false,
            name: 'Initial',
        } as unknown as ProjectStoreState;
    });

    describe('saveProject', () => {
        it('persists CRDT and updates store metadata', async () => {
            mocks.projectStoreValue.value = {
                name: 'My Song',
                createdAt: 1700000000000,
                dirty: true,
            } as unknown as ProjectStoreState;

            saveProject();

            // persistCrdtProject() is kicked off synchronously...
            expect(mocks.persistCrdtProject).toHaveBeenCalled();
            // ...but the recent-projects entry is only recorded once persistence
            // resolves (inside the .then()), and is keyed by the stable per-project
            // createdAt, not the mutable display name. So it has not happened yet.
            expect(mocks.addToRecentProjects).not.toHaveBeenCalled();

            await vi.waitFor(() => {
                expect(mocks.projectStoreSet).toHaveBeenCalledWith(expect.objectContaining({ dirty: false }));
            });

            // After the persist promise flushes, the entry is recorded against the
            // createdAt-keyed id (sourdaw:project:<createdAt>), not the name.
            expect(mocks.addToRecentProjects).toHaveBeenCalledWith('My Song', 'sourdaw:project:1700000000000');
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
