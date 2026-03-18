import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { type ProjectData, PROJECT_STORAGE_KEY } from '../models/ProjectData';

const projectStorage = new LocalStorageStorage<string>(PROJECT_STORAGE_KEY as 'webdaw-project');

export function readProjectJson(): string | null {
    return projectStorage.get();
}

export function writeProjectJson(json: string): void {
    projectStorage.set(json);
}

export function removeProjectJson(): void {
    projectStorage.clear();
}

export function writeNamedProjectJson(name: string, json: string): void {
    const projectKey = `webdaw:project:${name}`;
    try {
        localStorage.setItem(projectKey, json);
    } catch {
        /* storage full */
    }
}

export async function downloadProjectFile(data: ProjectData): Promise<void> {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const safeName = data.name.replaceAll(/[^a-zA-Z0-9_\- ]/g, '_');
    const filename = `${safeName}.webdaw`;

    // Try File System Access API for a proper native Save dialog
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as unknown as { showSaveFilePicker: (opts: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'WebDAW Project',
                    accept: { 'application/json': ['.webdaw'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch {
            // User cancelled or API error
            return;
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
