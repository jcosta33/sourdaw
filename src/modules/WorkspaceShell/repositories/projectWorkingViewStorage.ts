import { createPlainJsonLocalStorage } from '#/infra/store/storage/createPlainJsonLocalStorage';

import { decodeProjectWorkingView, type ProjectWorkingView } from '../models/ProjectWorkingView';

function getProjectWorkingViewStorageKey(projectId: string): `sourdaw:project-view:${string}` {
    return `sourdaw:project-view:${projectId}`;
}

function createProjectWorkingViewStorage(projectId: string) {
    return createPlainJsonLocalStorage<ProjectWorkingView>({
        key: getProjectWorkingViewStorageKey(projectId),
        decode: decodeProjectWorkingView,
    });
}

export function readProjectWorkingView(projectId: string): ProjectWorkingView | null {
    const storage = createProjectWorkingViewStorage(projectId);
    return storage.isSupported() ? storage.get() : null;
}

export function writeProjectWorkingView(projectId: string, view: ProjectWorkingView): boolean {
    const storage = createProjectWorkingViewStorage(projectId);
    if (!storage.isSupported()) {
        return false;
    }
    return storage.trySet?.(view) ?? false;
}
