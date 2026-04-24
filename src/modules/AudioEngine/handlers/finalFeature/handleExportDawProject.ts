import { logger } from '#/infra/logger/appLogger';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { isTauri } from '#/utils/tauriBridge';

async function saveBytes(bytes: Uint8Array, suggestedName: string): Promise<void> {
    if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeFile } = await import('@tauri-apps/plugin-fs');
        const filePath = await save({
            defaultPath: suggestedName,
            filters: [{ name: 'DAWproject', extensions: ['dawproject'] }],
        });
        if (!filePath) {
            return;
        }
        await writeFile(filePath, bytes);
        return;
    }

    const saveFilePicker = (window as unknown as {
        showSaveFilePicker?: (opts: { suggestedName: string; types?: unknown[] }) => Promise<{
            createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
        }>;
    }).showSaveFilePicker;

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
            const { exportDawProject } = await import('#/modules/Project/useCases');
            const { bytes, fileName } = await exportDawProject();
            await saveBytes(bytes, fileName);
            notifyUser(`Exported ${fileName}`, 'success');
        } catch (error) {
            logger.error(new Error('DAWproject export failed', { cause: error }));
            notifyUser('Failed to export DAWproject', 'error');
        }
    },
    describe: () => ({ label: 'Export DAWproject' }),
    undoable: false,
});
