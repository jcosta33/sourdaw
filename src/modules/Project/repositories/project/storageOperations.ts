import { LocalStorageStorage } from '#/helpers/Store/Storage/LocalStorageStorage';
import { PROJECT_STORAGE_KEY } from '../../models/ProjectData';

const projectStorage = new LocalStorageStorage<string>(PROJECT_STORAGE_KEY as 'sourdaw-project');

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
    const projectKey = `sourdaw:project:${name}`;
    try {
        localStorage.setItem(projectKey, json);
    } catch {
        /* storage full */
    }
}

export function readNamedProjectJson(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}
