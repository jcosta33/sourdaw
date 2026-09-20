import { isCanonicalProjectId } from '../models/ProjectData';
import { projectStore } from '../stores/projectStore';

export function getDurableProjectOwnerId(): string | undefined {
    const project = projectStore.value;
    if (
        !project?.initialized ||
        project.identityPersistencePending ||
        project.identityMigrationPending ||
        !isCanonicalProjectId(project.projectId)
    ) {
        return undefined;
    }

    return project.projectId;
}
