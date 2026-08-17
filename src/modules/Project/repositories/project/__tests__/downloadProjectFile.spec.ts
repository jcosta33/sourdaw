import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { desktopSaveDialog, isTauri } from '#/utils/tauriBridge';

import { saveProjectToFile } from '../../nativeProjectFiles/saveProjectToFile';
import { downloadProjectFile } from '../downloadProjectFile';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    desktopSaveDialog: vi.fn(),
}));

vi.mock('../../nativeProjectFiles/saveProjectToFile', () => ({
    saveProjectToFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(),
}));

describe('downloadProjectFile', () => {
    const projectData = {
        meta: { name: 'Test Project' },
        tracks: [],
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn(() => 'blob:url'),
            revokeObjectURL: vi.fn(),
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('should use Tauri save dialog in desktop', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(desktopSaveDialog).mockResolvedValue('/path/to/save.sourdaw');

        await downloadProjectFile(projectData);

        expect(desktopSaveDialog).toHaveBeenCalled();
        expect(saveProjectToFile).toHaveBeenCalledWith('/path/to/save.sourdaw', projectData);
    });

    it('should use showSaveFilePicker in browser if supported', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const mockWritable = {
            write: vi.fn(),
            close: vi.fn(),
        };
        const mockHandle = {
            createWritable: vi.fn().mockResolvedValue(mockWritable),
        };
        const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

        await downloadProjectFile(projectData);

        expect(showSaveFilePicker).toHaveBeenCalled();
        expect(mockWritable.write).toHaveBeenCalled();
        expect(mockWritable.close).toHaveBeenCalled();
    });

    it('should fallback to anchor download if picker fails or missing', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        // Picker missing

        const mockAnchor = {
            click: vi.fn(),
            style: {},
            href: '',
            download: '',
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
        vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);

        await downloadProjectFile(projectData);

        expect(mockAnchor.click).toHaveBeenCalled();
        expect(mockAnchor.download).toBe('Test_Project.sourdaw');

        vi.runAllTimers();
        expect(document.body.removeChild).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
});
