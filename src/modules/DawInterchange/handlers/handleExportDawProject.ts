import { logger } from '#/infra/logger/appLogger';
import { createHandler } from '#/utils/createHandler';
import { isDesktopRuntime } from '#/utils/desktopRuntime';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { exportDawProject } from '../useCases/exportDawProject';
import { saveDawProjectNativeFile } from '../useCases/saveDawProjectNativeFile';

type ShowSaveFilePicker = (opts: { suggestedName: string; types?: unknown[] }) => Promise<{
    createWritable: () => Promise<{
        write: (data: Uint8Array) => Promise<void>;
        close: () => Promise<void>;
    }>;
}>;

/**
 * The File System Access API (`window.showSaveFilePicker`) is not in the
 * standard `Window` lib types. Narrow the value at the call boundary instead
 * of asserting through `unknown`.
 */
function getShowSaveFilePicker(): ShowSaveFilePicker | null {
    const candidate = (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
    return typeof candidate === 'function' ? (candidate as ShowSaveFilePicker) : null;
}

async function saveBytes(bytes: Uint8Array, suggestedName: string): Promise<void> {
    if (isDesktopRuntime()) {
        await saveDawProjectNativeFile({ bytes, suggestedName });
        return;
    }

    const saveFilePicker = getShowSaveFilePicker();

    if (saveFilePicker) {
        try {
            const handle = await saveFilePicker.call(window, {
                suggestedName,
                types: [{ accept: { 'application/zip': ['.dawproject'] } }],
            });
            const writable = await handle.createWritable();
            await writable.write(bytes);
            await writable.close();
            return;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
            logger.warn('[handleExportDawProject] showSaveFilePicker failed — falling back to blob download', error);
        }
    }

    const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1500);
}

export const handleExportDawProject = createHandler<'exportDawProject'>({
    execute: async () => {
        try {
            const { bytes, fileName, missingAudioCount } = await exportDawProject();
            await saveBytes(bytes, fileName);
            if (missingAudioCount > 0) {
                // Same warning the `.sourdaw` export path already gives for the
                // same cause (audit M-263). The clips are in the file; their
                // audio is not, so the destination DAW plays silence there.
                notifyUser(
                    `${String(missingAudioCount)} audio file${missingAudioCount > 1 ? 's' : ''} could not be bundled with the export — those clips will be silent in the destination DAW.`,
                    'warning'
                );
            }
            notifyUser(`Exported ${fileName}`, 'success');
        } catch (error) {
            logger.error(new Error('DAWproject export failed', { cause: error }));
            notifyUser('Failed to export DAWproject', 'error');
        }
    },
    describe: () => ({ label: 'Export DAWproject' }),
    undoable: false,
});
