import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCrdtProject } from '../createCrdtProject';

const mocks = vi.hoisted(() => ({
    createProject: vi.fn(),
    compactProject: vi.fn(),
}));

vi.mock('../../repositories/automergeRepository', () => ({
    automergeRepository: {
        createProject: mocks.createProject,
    },
}));
vi.mock('../compactProject', () => ({ compactProject: mocks.compactProject }));

describe('createCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compactProject.mockResolvedValue(undefined);
    });

    it('should initialize the repository and compact', async () => {
        await createCrdtProject('New Project');

        expect(mocks.createProject).toHaveBeenCalledWith('New Project');
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });
});
