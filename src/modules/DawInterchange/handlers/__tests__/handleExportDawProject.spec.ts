import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopRuntime';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { exportDawProject } from '../../useCases/exportDawProject';
import { saveDawProjectNativeFile } from '../../useCases/saveDawProjectNativeFile';
import { handleExportDawProject } from '../handleExportDawProject';

type BrowserFileHandle = {
    createWritable: () => Promise<{
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
    }>;
};

type BrowserSaveFilePicker = (opts: {
    suggestedName: string;
    types?: Array<{ accept: { 'application/zip': string[] } }>;
}) => Promise<BrowserFileHandle>;

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        setWriters: vi.fn(),
        warn: vi.fn(),
    },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('../../useCases/exportDawProject', () => ({
    exportDawProject: vi.fn(),
}));

vi.mock('#/utils/desktopRuntime', () => ({
    isDesktopRuntime: vi.fn(),
}));

vi.mock('../../useCases/saveDawProjectNativeFile', () => ({
    saveDawProjectNativeFile: vi.fn(),
}));

describe('handleExportDawProject', () => {
    const bytes = new Uint8Array([4, 5, 6]);

    beforeEach(() => {
        vi.mocked(exportDawProject).mockReset();
        vi.mocked(saveDawProjectNativeFile).mockReset();
        vi.mocked(notifyUser).mockReset();
        vi.mocked(isDesktopRuntime).mockReset();
        vi.mocked(logger.error).mockReset();
        vi.mocked(logger.warn).mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should save DAWproject bytes through native repositories and notify success', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.mocked(saveDawProjectNativeFile).mockResolvedValue(undefined);

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectNativeFile).toHaveBeenCalledWith({ bytes, suggestedName: 'session.dawproject' });
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should return without writing when the native save dialog is cancelled', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.mocked(saveDawProjectNativeFile).mockResolvedValue(undefined);

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectNativeFile).toHaveBeenCalledWith({ bytes, suggestedName: 'session.dawproject' });
        expect(logger.error).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should keep browser showSaveFilePicker export behavior unchanged', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });

        const writable = {
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            write: vi.fn<(data: Uint8Array) => Promise<void>>().mockResolvedValue(undefined),
        };
        const handle = {
            createWritable: vi.fn<() => Promise<typeof writable>>().mockResolvedValue(writable),
        };
        const showSaveFilePicker = vi.fn<BrowserSaveFilePicker>().mockResolvedValue(handle);
        vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(showSaveFilePicker).toHaveBeenCalledWith({
            suggestedName: 'session.dawproject',
            types: [{ accept: { 'application/zip': ['.dawproject'] } }],
        });
        expect(writable.write).toHaveBeenCalledWith(bytes);
        expect(writable.close).toHaveBeenCalled();
        expect(saveDawProjectNativeFile).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should log and notify when export fails', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockRejectedValue(new Error('zip failed'));

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectNativeFile).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith('Failed to export DAWproject', 'error');
        expect(logger.error).toHaveBeenCalledTimes(1);

        const loggedError = vi.mocked(logger.error).mock.calls.at(0)?.[0];
        expect(loggedError).toBeInstanceOf(Error);
        if (!(loggedError instanceof Error)) {
            throw new Error('Expected logger.error to receive an Error');
        }
        expect(loggedError.message).toBe('DAWproject export failed');
    });
});
