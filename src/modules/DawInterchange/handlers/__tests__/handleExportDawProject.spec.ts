import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';
import { isDesktopRuntime } from '#/utils/desktopRuntime';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { saveDawProjectFileDialog } from '../../repositories/saveDawProjectFileDialog';
import { writeDawProjectFile } from '../../repositories/writeDawProjectFile';
import { exportDawProject } from '../../useCases/exportDawProject';
import { handleExportDawProject } from '../handleExportDawProject';

type BrowserFileHandle = {
    createWritable: () => Promise<{
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
        abort: () => Promise<void>;
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

vi.mock('../../repositories/saveDawProjectFileDialog', () => ({ saveDawProjectFileDialog: vi.fn() }));
vi.mock('../../repositories/writeDawProjectFile', () => ({ writeDawProjectFile: vi.fn() }));

describe('handleExportDawProject', () => {
    const bytes = new Uint8Array([4, 5, 6]);

    beforeEach(() => {
        vi.mocked(exportDawProject).mockReset();
        vi.mocked(saveDawProjectFileDialog).mockReset();
        vi.mocked(writeDawProjectFile).mockReset();
        vi.mocked(notifyUser).mockReset();
        vi.mocked(isDesktopRuntime).mockReset();
        vi.mocked(logger.error).mockReset();
        vi.mocked(logger.warn).mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should save DAWproject bytes through native repositories and notify success', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue('/tmp/session.dawproject');

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectFileDialog).toHaveBeenCalledWith({ suggestedName: 'session.dawproject' });
        expect(writeDawProjectFile).toHaveBeenCalledWith({ filePath: '/tmp/session.dawproject', bytes });
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should return without writing when the native save dialog is cancelled', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 2 });
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue(null);

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectFileDialog).toHaveBeenCalledWith({ suggestedName: 'session.dawproject' });
        expect(writeDawProjectFile).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('should notify native success only after the file write completes', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue('/tmp/session.dawproject');
        let finishWrite!: () => void;
        const writeFinished = new Promise<void>((resolve) => {
            finishWrite = resolve;
        });
        let writeStarted!: () => void;
        const writeCalled = new Promise<void>((resolve) => {
            writeStarted = resolve;
        });
        vi.mocked(writeDawProjectFile).mockImplementation(() => {
            writeStarted();
            return writeFinished;
        });

        const exportFinished = handleExportDawProject.execute({ type: 'exportDawProject' });
        await writeCalled;
        expect(notifyUser).not.toHaveBeenCalled();

        finishWrite();
        await exportFinished;
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should report a native write failure as an error without success', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.mocked(saveDawProjectFileDialog).mockResolvedValue('/tmp/session.dawproject');
        vi.mocked(writeDawProjectFile).mockRejectedValue(new Error('disk full'));

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith('Failed to export DAWproject', 'error');
    });

    it('should keep browser showSaveFilePicker export behavior unchanged', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });

        const writable = {
            close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            write: vi.fn<(data: Uint8Array) => Promise<void>>().mockResolvedValue(undefined),
            abort: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
        expect(saveDawProjectFileDialog).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should notify browser success only after the writable is closed', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        let finishClose!: () => void;
        const closeFinished = new Promise<void>((resolve) => {
            finishClose = resolve;
        });
        let closeStarted!: () => void;
        const closeCalled = new Promise<void>((resolve) => {
            closeStarted = resolve;
        });
        const writable = {
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockImplementation(() => {
                closeStarted();
                return closeFinished;
            }),
            abort: vi.fn().mockResolvedValue(undefined),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: () => Promise.resolve(writable) })
        );

        const exportFinished = handleExportDawProject.execute({ type: 'exportDawProject' });
        await closeCalled;
        expect(notifyUser).not.toHaveBeenCalled();

        finishClose();
        await exportFinished;
        expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
    });

    it('should report a deferred browser close failure without notifying success', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        const failure = new Error('close failed');
        let failClose!: (reason: Error) => void;
        const closeFinished = new Promise<void>((_resolve, reject) => {
            failClose = reject;
        });
        // Keep the rejection handled when probing code that forgets to await close().
        void closeFinished.catch(() => undefined);
        let closeStarted!: () => void;
        const closeCalled = new Promise<void>((resolve) => {
            closeStarted = resolve;
        });
        const writable = {
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockImplementation(() => {
                closeStarted();
                return closeFinished;
            }),
            abort: vi.fn().mockResolvedValue(undefined),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: () => Promise.resolve(writable) })
        );

        const exportFinished = handleExportDawProject.execute({ type: 'exportDawProject' });
        await closeCalled;
        failClose(failure);
        await exportFinished;

        expect(writable.abort).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toMatchObject({ cause: failure });
        expect(notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to export DAWproject', 'error');
    });

    it('should stay silent when the browser save picker is cancelled', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 0 });
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError')));

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it.each([
        ['createWritable', new DOMException('Could not open stream', 'AbortError')],
        ['write', new DOMException('Write aborted', 'AbortError')],
        ['write', new Error('disk full')],
        ['close', new DOMException('Close aborted', 'AbortError')],
        ['close', new Error('disk full')],
    ] as const)('should report %s failure after selecting a browser file', async (stage, failure) => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({
            bytes,
            fileName: 'session.dawproject',
            missingAudioCount: 2,
        });
        const writable = {
            write: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockResolvedValue(undefined),
        };
        const createWritable = vi.fn().mockResolvedValue(writable);
        if (stage === 'createWritable') {
            createWritable.mockRejectedValue(failure);
        } else {
            writable[stage].mockRejectedValue(failure);
        }
        vi.stubGlobal('showSaveFilePicker', vi.fn().mockResolvedValue({ createWritable }));
        const createObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(createWritable).toHaveBeenCalledTimes(1);
        expect(writable.abort).toHaveBeenCalledTimes(stage === 'createWritable' ? 0 : 1);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toMatchObject({ cause: failure });
        expect(notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to export DAWproject', 'error');
    });

    it('should preserve the write failure when abort also fails', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);
        vi.mocked(exportDawProject).mockResolvedValue({ bytes, fileName: 'session.dawproject', missingAudioCount: 2 });
        const failure = new Error('write failed');
        const writable = {
            write: vi.fn().mockRejectedValue(failure),
            close: vi.fn().mockResolvedValue(undefined),
            abort: vi.fn().mockRejectedValue(new Error('abort failed')),
        };
        vi.stubGlobal(
            'showSaveFilePicker',
            vi.fn().mockResolvedValue({ createWritable: () => Promise.resolve(writable) })
        );
        const createObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(writable.abort).toHaveBeenCalledTimes(1);
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toMatchObject({ cause: failure });
        expect(notifyUser).toHaveBeenCalledExactlyOnceWith('Failed to export DAWproject', 'error');
    });

    it.each(['unavailable', 'picker error'])(
        'should dispatch a blob download when the picker is %s',
        async (picker) => {
            vi.mocked(isDesktopRuntime).mockReturnValue(false);
            vi.mocked(exportDawProject).mockResolvedValue({
                bytes,
                fileName: 'session.dawproject',
                missingAudioCount: 0,
            });
            if (picker === 'picker error') {
                vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(new Error('picker unavailable')));
            } else {
                vi.stubGlobal('showSaveFilePicker', undefined);
            }
            const createObjectURL = vi.fn().mockReturnValue('blob:test');
            vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
            const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

            await handleExportDawProject.execute({ type: 'exportDawProject' });

            expect(createObjectURL).toHaveBeenCalledTimes(1);
            expect(click).toHaveBeenCalledTimes(1);
            expect(notifyUser).toHaveBeenCalledWith('Exported session.dawproject', 'success');
            expect(logger.warn).toHaveBeenCalledTimes(picker === 'picker error' ? 1 : 0);
        }
    );

    it('should log and notify when export fails', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(exportDawProject).mockRejectedValue(new Error('zip failed'));

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        expect(saveDawProjectFileDialog).not.toHaveBeenCalled();
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
