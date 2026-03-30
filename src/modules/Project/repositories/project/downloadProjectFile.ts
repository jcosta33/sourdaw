import { type ProjectData } from '../../models/ProjectData';
import { isTauri } from '#/helpers/tauriBridge';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/**
 * Download a project as a .sourdaw file.
 * Uses Tauri native save for desktop, and File System Access API for web (with anchor fallback).
 */
export async function downloadProjectFile(data: ProjectData): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    const safeName = data.name.replaceAll(/[^a-zA-Z0-9_\- ]/g, '_');
    const filename = `${safeName}.sourdaw`;

    if (isTauri()) {
        try {
            const filePath = await save({
                defaultPath: filename,
                filters: [{ name: 'Sourdaw Project', extensions: ['sourdaw'] }],
            });
            if (filePath) {
                const encoder = new TextEncoder();
                const bytes = encoder.encode(json);
                await writeFile(filePath, bytes);
            }
        } catch (error) {
            console.warn('Tauri save failed:', error);
        }
        return;
    }

    const blob = new Blob([json], { type: 'application/json' });

    // Try File System Access API for a proper native Save dialog
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (
                window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }
            ).showSaveFilePicker({
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
            console.warn('showSaveFilePicker failed, falling back to anchor download:', error);
        }
    }

    // Fallback: anchor download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
}
