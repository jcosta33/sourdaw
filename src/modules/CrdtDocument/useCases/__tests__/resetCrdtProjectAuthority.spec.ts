import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCrdtProjectAuthority } from '../resetCrdtProjectAuthority';

const mocks = vi.hoisted(() => ({
    branchStoreSet: vi.fn(),
    createProject: vi.fn(),
}));

vi.mock('../../stores/branchStore', () => ({
    branchStore: { set: mocks.branchStoreSet },
    MAIN_BRANCH_ID: 'main',
}));
vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: { createProject: mocks.createProject },
}));

describe('resetCrdtProjectAuthority', () => {
    beforeEach(() => vi.clearAllMocks());

    it('replaces branch authority before clearing the document repository', () => {
        resetCrdtProjectAuthority('Imported');

        expect(mocks.branchStoreSet).toHaveBeenCalledWith({
            branches: [expect.objectContaining({ branchId: 'main', rootDocId: 'root', sourceBranchId: null })],
            activeBranchId: 'main',
        });
        expect(mocks.branchStoreSet.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.createProject.mock.invocationCallOrder[0]!
        );
        expect(mocks.createProject).toHaveBeenCalledWith('Imported');
    });
});
