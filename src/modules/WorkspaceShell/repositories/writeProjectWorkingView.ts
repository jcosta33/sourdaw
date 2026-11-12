import { type ProjectWorkingView } from '../models/ProjectWorkingView';

import { createProjectWorkingViewStorage } from './createProjectWorkingViewStorage';

export function writeProjectWorkingView(projectId: string, view: ProjectWorkingView): boolean {
    const storage = createProjectWorkingViewStorage(projectId);
    if (!storage.isSupported()) {
        return false;
    }
    return storage.trySet?.(view) ?? false;
}
