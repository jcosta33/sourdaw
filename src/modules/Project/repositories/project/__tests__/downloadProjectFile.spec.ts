import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { desktopSaveDialog, isDesktopRuntime } from '#/utils/desktopBridge';

import { saveProjectToFile } from '../../nativeProjectFiles/saveProjectToFile';
import { downloadProjectFile } from '../downloadProjectFile';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(),
    desktopSaveDialog: vi.fn(),
}));

vi.mock('../../nativeProjectFiles/saveProjectToFile', () => ({
    saveProjectToFile: vi.fn(),
}));

function createDeferred<Value>(): {
    promise: Promise<Value>;
    reject: (reason?: unknown) => void;
    resolve: (value: Value) => void;
} {
    let rejectDeferred!: (reason?: unknown) => void;
    let resolveDeferred!: (value: Value) => void;
    const promise = new Promise<Value>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });
    return { promise, reject: rejectDeferred, resolve: resolveDeferred };
}

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
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('should use the native save dialog on desktop', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopSaveDialog).mockResolvedValue('/path/to/save.sourdaw');

        const outcome = await downloadProjectFile({ data: projectData, shouldWrite: () => true });

        expect(desktopSaveDialog).toHaveBeenCalled();
        expect(saveProjectToFile).toHaveBeenCalledWith('/path/to/save.sourdaw', projectData);
        expect(outcome).toBe('written');
    });

    it('rejects a desktop write when authority changes during the save dialog', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        const dialog = createDeferred<string | null>();
        vi.mocked(desktopSaveDialog).mockReturnValue(dialog.promise);
        let shouldWrite = true;

        const download = downloadProjectFile({ data: projectData, shouldWrite: () => shouldWrite });
        await vi.waitFor(() => {
            expect(desktopSaveDialog).toHaveBeenCalledTimes(1);
        });
        shouldWrite = false;
        dialog.resolve('/path/to/stale.sourdaw');

        await expect(download).resolves.toBe('rejected-stale');
        expect(saveProjectToFile).not.toHaveBeenCalled();
    });

    it('reports a cancelled desktop save dialog without writing', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopSaveDialog).mockResolvedValue(null);

        await expect(downloadProjectFile({ data: projectData, shouldWrite: () => true })).resolves.toBe('cancelled');

        expect(saveProjectToFile).not.toHaveBeenCalled();
    });

    it('should use showSaveFilePicker in browser if supported', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        const mockWritable = {
            write: vi.fn(),
            close: vi.fn(),
        };
        const mockHandle = {
            createWritable: vi.fn().mockResolvedValue(mockWritable),
        };
        const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

        const outcome = await downloadProjectFile({ data: projectData, shouldWrite: () => true });

        expect(showSaveFilePicker).toHaveBeenCalled();
        expect(mockWritable.write).toHaveBeenCalled();
        expect(mockWritable.close).toHaveBeenCalled();
        expect(outcome).toBe('written');
    });

    it('rejects a web write when authority changes while creating the writable target', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        const writable = {
            write: vi.fn(),
            close: vi.fn(),
        };
        const writableTarget = createDeferred<typeof writable>();
        const createWritable = vi.fn().mockReturnValue(writableTarget.promise);
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable }));
        let shouldWrite = true;

        const download = downloadProjectFile({ data: projectData, shouldWrite: () => shouldWrite });
        await vi.waitFor(() => {
            expect(createWritable).toHaveBeenCalledTimes(1);
        });
        shouldWrite = false;
        writableTarget.resolve(writable);

        await expect(download).resolves.toBe('rejected-stale');
        expect(writable.write).not.toHaveBeenCalled();
        expect(writable.close).not.toHaveBeenCalled();
    });

    it('reports a cancelled web picker without falling back to a download', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        const cancellation = new Error('cancelled');
        cancellation.name = 'AbortError';
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(cancellation));

        await expect(downloadProjectFile({ data: projectData, shouldWrite: () => true })).resolves.toBe('cancelled');

        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should fallback to anchor download if picker fails or missing', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
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

        const outcome = await downloadProjectFile({ data: projectData, shouldWrite: () => true });

        expect(mockAnchor.click).toHaveBeenCalled();
        expect(mockAnchor.download).toBe('Test_Project.sourdaw');
        expect(outcome).toBe('written');

        vi.runAllTimers();
        expect(document.body.removeChild).toHaveBeenCalled();
        expect(URL.revokeObjectURL).toHaveBeenCalled();
    });

    it('rejects fallback download when authority changes while the picker fails', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        const picker = createDeferred<FileSystemFileHandle>();
        const showSaveFilePicker = vi.fn().mockReturnValue(picker.promise);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);
        const mockAnchor = {
            click: vi.fn(),
            style: {},
            href: '',
            download: '',
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockAnchor as any);
        vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockAnchor as any);
        let shouldWrite = true;

        const download = downloadProjectFile({ data: projectData, shouldWrite: () => shouldWrite });
        await vi.waitFor(() => {
            expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
        });
        shouldWrite = false;
        picker.reject(new Error('picker failed'));

        await expect(download).resolves.toBe('rejected-stale');
        expect(mockAnchor.click).not.toHaveBeenCalled();
    });
});
