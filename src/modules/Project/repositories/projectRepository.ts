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

export function downloadProjectFile(data: ProjectData): void {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.webdaw`;
    a.click();
    URL.revokeObjectURL(url);
}
