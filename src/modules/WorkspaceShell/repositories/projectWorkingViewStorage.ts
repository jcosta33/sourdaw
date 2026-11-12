import { type ProjectWorkingView } from '../models/ProjectWorkingView';
import { createProjectWorkingViewStorage } from './createProjectWorkingViewStorage';

export function readProjectWorkingView(projectId: string): ProjectWorkingView | null {
    const storage = createProjectWorkingViewStorage(projectId);
    return storage.isSupported() ? storage.get() : null;
}
