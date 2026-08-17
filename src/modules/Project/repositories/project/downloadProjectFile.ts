import { logger } from '#/infra/logger/appLogger';
import { desktopSaveDialog, isTauri } from '#/utils/tauriBridge';

import { type ProjectData } from '../../models/ProjectData';
import { saveProjectToFile } from '../nativeProjectFiles/saveProjectToFile';

type WindowWithFilePicker = Window & {
    showSaveFilePicker: (opts: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
};

/**
 * Download a project as a .sourdaw file.
 * Uses Tauri native save for desktop, and File System Access API for web (with anchor fallback).
 */
export async function downloadProjectFile(data: ProjectData): Promise<void> {
    const safeName = data.meta.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}.sourdaw`;

    if (isTauri()) {
        const filePath = await desktopSaveDialog({
            defaultPath: filename,
            filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
        });
        if (filePath) {
            await saveProjectToFile(filePath, data);
        }
        return;
    }

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    // Try File System Access API for a proper native Save dialog
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as WindowWithFilePicker).showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: 'Sourdaw Project',
                        accept: { 'application/json': ['.sourdaw'] },
                    },
                ],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (error) {
            // User cancelled
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
            logger.warn('showSaveFilePicker failed, falling back to anchor download:', error);
        }
    }

    // Fallback: anchor download
    const url = URL.createObjectURL(blob);
    const alpha = document.createElement('a');
    alpha.href = url;
    alpha.download = filename;
    alpha.style.display = 'none';
    document.body.appendChild(alpha);
    alpha.click();
    setTimeout(() => {
        document.body.removeChild(alpha);
        URL.revokeObjectURL(url);
    }, 1000);
}
