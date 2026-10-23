import { projectStore } from '../../stores/projectStore';
import { getProjectSnapshotKey } from '../projectPersistence/getProjectSnapshotKey';

/** True when a Recent entry's key names the project that is open right now. */
export function isOpenProjectKey(key: string): boolean {
    const project = projectStore.value;
    return project !== null && getProjectSnapshotKey(project.createdAt) === key;
}
