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
        const result = await createCrdtProject({ name: 'New Project', canActivate: () => true });

        expect(result).toBe(true);
        expect(mocks.createProject).toHaveBeenCalledWith('New Project');
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });

    it('should not assign an inactive project to the repository', async () => {
        const result = await createCrdtProject({ name: 'Stale Project', canActivate: () => false });

        expect(result).toBe(false);
        expect(mocks.createProject).not.toHaveBeenCalled();
        expect(mocks.compactProject).not.toHaveBeenCalled();
    });
});
