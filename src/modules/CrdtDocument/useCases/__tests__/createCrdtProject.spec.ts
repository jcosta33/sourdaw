import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCrdtProject } from '../createCrdtProject';

const mocks = vi.hoisted(() => ({
    compactProject: vi.fn(),
    resetCrdtProjectAuthority: vi.fn(),
}));

vi.mock('../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../resetCrdtProjectAuthority', () => ({
    resetCrdtProjectAuthority: mocks.resetCrdtProjectAuthority,
}));

describe('createCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compactProject.mockResolvedValue(undefined);
    });

    it('should initialize the repository and compact', async () => {
        await createCrdtProject('New Project');

        expect(mocks.resetCrdtProjectAuthority).toHaveBeenCalledWith('New Project');
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });
});
