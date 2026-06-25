import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../repositories/nativeProjectFiles/loadProjectFromFile', () => ({
    loadProjectFromFile: vi.fn(),
}));

vi.mock('../applyImportedProjectData', () => ({
    applyImportedProjectData: vi.fn(() => Promise.resolve(true)),
}));

import { CURRENT_PROJECT_VERSION, MIN_SUPPORTED_PROJECT_VERSION } from '../../../../models/ProjectData';
import { loadProjectFromFile } from '../../../../repositories/nativeProjectFiles/loadProjectFromFile';
import { applyImportedProjectData } from '../applyImportedProjectData';
import { importProjectFile, importProjectFromNativePath } from '../pickAndImportProjectFile';

function fileWithText(text: string): File {
    return { text: () => Promise.resolve(text) } as File;
}

/** Minimal project body that passes the structural checks once the version is accepted. */
function projectBody(version: number): string {
    return JSON.stringify({
        version,
        meta: { name: 'P' },
        arrangement: { tracks: [] },
    });
}

describe('importProjectFile', () => {
    beforeEach(() => {
        vi.mocked(applyImportedProjectData).mockClear();
        vi.mocked(applyImportedProjectData).mockResolvedValue(true);
    });

    it('should return false when the file is not valid JSON', async () => {
        const ok = await importProjectFile(fileWithText('not json {'));

        expect(ok).toBe(false);
    });

    it('should return false when tracks are missing', async () => {
        const ok = await importProjectFile(
            fileWithText(JSON.stringify({ version: CURRENT_PROJECT_VERSION, meta: { name: 'P' } }))
        );

        expect(ok).toBe(false);
    });

    it('should return false when meta is missing', async () => {
        const ok = await importProjectFile(
            fileWithText(JSON.stringify({ version: CURRENT_PROJECT_VERSION, arrangement: { tracks: [] } }))
        );

        expect(ok).toBe(false);
    });

    it('should accept a file at the current project version', async () => {
        const ok = await importProjectFile(fileWithText(projectBody(CURRENT_PROJECT_VERSION)));

        expect(ok).toBe(true);
        expect(applyImportedProjectData).toHaveBeenCalledTimes(1);
    });

    it('should reject a file one version above the current version without applying it', async () => {
        const ok = await importProjectFile(fileWithText(projectBody(CURRENT_PROJECT_VERSION + 1)));

        expect(ok).toBe(false);
        expect(applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('should reject a file below the minimum supported version without applying it', async () => {
        const ok = await importProjectFile(fileWithText(projectBody(MIN_SUPPORTED_PROJECT_VERSION - 1)));

        expect(ok).toBe(false);
        expect(applyImportedProjectData).not.toHaveBeenCalled();
    });
});

describe('importProjectFromNativePath', () => {
    beforeEach(() => {
        vi.mocked(loadProjectFromFile).mockReset();
        vi.mocked(applyImportedProjectData).mockClear();
        vi.mocked(applyImportedProjectData).mockResolvedValue(true);
    });

    it('should return false when loadProjectFromFile throws', async () => {
        vi.mocked(loadProjectFromFile).mockRejectedValue(new Error('read failed'));

        const ok = await importProjectFromNativePath('/path/project.sourdaw');

        expect(ok).toBe(false);
    });

    it('should reject a future-version native file without applying it', async () => {
        vi.mocked(loadProjectFromFile).mockResolvedValue({
            version: CURRENT_PROJECT_VERSION + 1,
            meta: { name: 'P' },
            arrangement: { tracks: [] },
        } as never);

        const ok = await importProjectFromNativePath('/path/project.sourdaw');

        expect(ok).toBe(false);
        expect(applyImportedProjectData).not.toHaveBeenCalled();
        expect(loadProjectFromFile).toHaveBeenCalledWith('/path/project.sourdaw');
    });

    it('should accept a current-version native file', async () => {
        vi.mocked(loadProjectFromFile).mockResolvedValue({
            version: CURRENT_PROJECT_VERSION,
            meta: { name: 'P' },
            arrangement: { tracks: [] },
        } as never);

        const ok = await importProjectFromNativePath('/path/project.sourdaw');

        expect(ok).toBe(true);
        expect(applyImportedProjectData).toHaveBeenCalledTimes(1);
    });
});
