import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    replaceProjectData: vi.fn(),
    clearLastProjectDirectoryBinding: vi.fn(),
}));

vi.mock('../../helpers/replaceProjectData', () => ({ replaceProjectData: mocks.replaceProjectData }));
vi.mock('../../helpers/normalizeLegacyProjectData', () => ({ normalizeLegacyProjectData: (value: unknown) => value }));
vi.mock('../../helpers/isHydratableProjectData', () => ({ isHydratableProjectData: () => true }));
vi.mock('../../helpers/runProjectLoadTransaction', () => ({ runProjectLoadTransaction: () => ({}) }));
vi.mock('../../../../repositories/project/projectDirectoryBinding', () => ({
    projectDirectoryBinding: { clearLastProjectDirectoryBinding: mocks.clearLastProjectDirectoryBinding },
}));

import { applyImportedProjectData } from '../applyImportedProjectData';

const importedProject = { meta: { projectId: 'imported-project' } };

describe('applyImportedProjectData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.clearLastProjectDirectoryBinding.mockResolvedValue(undefined);
    });

    it('clears the imported project folder binding after a committed replacement', async () => {
        mocks.replaceProjectData.mockResolvedValue({ status: 'committed' });

        await expect(applyImportedProjectData({ data: importedProject })).resolves.toBe(true);

        expect(mocks.clearLastProjectDirectoryBinding).toHaveBeenCalledExactlyOnceWith('imported-project');
    });

    it.each(['failed', 'aborted'])('leaves the folder binding alone when the replacement is %s', async (status) => {
        mocks.replaceProjectData.mockResolvedValue({ status });

        await expect(applyImportedProjectData({ data: importedProject })).resolves.toBe(false);

        expect(mocks.clearLastProjectDirectoryBinding).not.toHaveBeenCalled();
    });
});
