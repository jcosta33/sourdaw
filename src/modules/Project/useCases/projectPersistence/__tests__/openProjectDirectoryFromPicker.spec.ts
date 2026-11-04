import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    beginProjectDirectorySelection: vi.fn(),
    bindProjectDirectoryRoot: vi.fn(),
    prepareProjectDirectoryRead: vi.fn(),
    loadProject: vi.fn(),
    saveProjectBeforeReplacement: vi.fn(),
    capture: vi.fn(),
}));

vi.mock('../../../repositories/project/projectDirectoryBinding', () => ({
    projectDirectoryBinding: {
        beginProjectDirectorySelection: mocks.beginProjectDirectorySelection,
        bindProjectDirectoryRoot: mocks.bindProjectDirectoryRoot,
    },
}));
vi.mock('../../../stores/projectStore', () => ({ projectStore: { value: { dirty: true } } }));
vi.mock('../getProjectSnapshotKey', () => ({ getProjectSnapshotKey: () => 'recent-key' }));
vi.mock('../helpers/runProjectLoadTransaction', () => ({ runProjectLoadTransaction: () => ({}) }));
vi.mock('../loadProject', () => ({ loadProject: mocks.loadProject }));
vi.mock('../pendingProjectReplacements', () => ({ pendingProjectReplacements: { capture: mocks.capture } }));
vi.mock('../projectDirectoryRead', () => ({ prepareProjectDirectoryRead: mocks.prepareProjectDirectoryRead }));
vi.mock('../saveProject/saveProjectBeforeReplacement', () => ({
    saveProjectBeforeReplacement: mocks.saveProjectBeforeReplacement,
}));

import { openProjectDirectoryFromPicker } from '../openProjectDirectoryFromPicker';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('openProjectDirectoryFromPicker', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.capture.mockReturnValue(() => true);
        mocks.beginProjectDirectorySelection.mockResolvedValue({ name: projectId });
        mocks.saveProjectBeforeReplacement.mockResolvedValue('save-closed-takes');
        mocks.prepareProjectDirectoryRead.mockResolvedValue({
            projectId,
            projectName: 'Folder project',
            createdAt: 1,
            media: new Map(),
        });
        mocks.loadProject.mockResolvedValue(true);
        mocks.bindProjectDirectoryRoot.mockResolvedValue(undefined);
    });

    it('keeps the open project when the user cancels the leave-without-saving dialog', async () => {
        mocks.saveProjectBeforeReplacement.mockResolvedValue('stay');

        await expect(openProjectDirectoryFromPicker()).resolves.toBe(false);

        expect(mocks.loadProject).not.toHaveBeenCalled();
        expect(mocks.prepareProjectDirectoryRead).not.toHaveBeenCalled();
    });

    it('threads the chosen disposition into the folder load', async () => {
        await expect(openProjectDirectoryFromPicker()).resolves.toBe(true);

        expect(mocks.loadProject).toHaveBeenCalledWith(
            expect.objectContaining({ explicit: true, outgoingProject: 'save-closed-takes' })
        );
    });

    it("threads Don't Save into the folder load as a discard", async () => {
        mocks.saveProjectBeforeReplacement.mockResolvedValue('discard');

        await expect(openProjectDirectoryFromPicker()).resolves.toBe(true);

        expect(mocks.loadProject).toHaveBeenCalledWith(expect.objectContaining({ outgoingProject: 'discard' }));
    });

    it('abandons the choice when a newer project transition supersedes it', async () => {
        mocks.capture.mockReturnValue(() => false);

        await expect(openProjectDirectoryFromPicker()).resolves.toBe(false);

        expect(mocks.loadProject).not.toHaveBeenCalled();
    });
});
