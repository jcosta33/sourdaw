import { logger } from '#/infra/logger/appLogger';
import { desktopSaveDialog, isDesktopRuntime } from '#/utils/desktopBridge';

import { type ProjectData } from '../../models/ProjectData';
import { saveProjectToFile } from '../nativeProjectFiles/saveProjectToFile';

type WindowWithFilePicker = Window & {
    showSaveFilePicker: (opts: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<FileSystemFileHandle>;
};

type DownloadProjectFileInput = {
    data: ProjectData;
    shouldWrite: () => boolean;
};

export type DownloadProjectFileOutcome = 'written' | 'cancelled' | 'rejected-stale';

/**
 * Download a project as a .sourdaw file.
 * Uses the native save dialog for desktop, and File System Access API for web (with anchor fallback).
 */
export async function downloadProjectFile({
    data,
    shouldWrite,
}: DownloadProjectFileInput): Promise<DownloadProjectFileOutcome> {
    if (!shouldWrite()) {
        return 'rejected-stale';
    }
    const safeName = data.meta.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${safeName}.sourdaw`;

    if (isDesktopRuntime()) {
        const filePath = await desktopSaveDialog({
            defaultPath: filename,
            filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
        });
        if (!filePath) {
            return 'cancelled';
        }
        if (!shouldWrite()) {
            return 'rejected-stale';
        }
        await saveProjectToFile(filePath, data);
        return 'written';
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
            if (!shouldWrite()) {
                return 'rejected-stale';
            }
            const writable = await handle.createWritable();
            if (!shouldWrite()) {
                return 'rejected-stale';
            }
            await writable.write(blob);
            if (!shouldWrite()) {
                await writable.abort();
                return 'rejected-stale';
            }
            await writable.close();
            return 'written';
        } catch (error) {
            // User cancelled
            if (error instanceof Error && error.name === 'AbortError') {
                return 'cancelled';
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
    if (!shouldWrite()) {
        document.body.removeChild(alpha);
        URL.revokeObjectURL(url);
        return 'rejected-stale';
    }
    alpha.click();
    setTimeout(() => {
        document.body.removeChild(alpha);
        URL.revokeObjectURL(url);
    }, 1000);
    return 'written';
}
