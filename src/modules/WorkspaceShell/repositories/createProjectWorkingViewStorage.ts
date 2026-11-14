import { createPlainJsonLocalStorage } from '#/infra/store/storage/createPlainJsonLocalStorage';

import { decodeProjectWorkingView, type ProjectWorkingView } from '../models/ProjectWorkingView';

function getProjectWorkingViewStorageKey(projectId: string): `sourdaw:project-view:${string}` {
    return `sourdaw:project-view:${projectId}`;
}

export function createProjectWorkingViewStorage(projectId: string) {
    return createPlainJsonLocalStorage<ProjectWorkingView>({
        key: getProjectWorkingViewStorageKey(projectId),
        decode: decodeProjectWorkingView,
    });
}
