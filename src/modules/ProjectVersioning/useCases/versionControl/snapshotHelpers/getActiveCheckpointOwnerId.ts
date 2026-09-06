import { getSettledProjectId, projectStore } from '#/modules/Project/stores';

/** Return the active project identity only after its in-session lifecycle has settled. */
export function getActiveCheckpointOwnerId(): string | undefined {
    const project = projectStore.value;
    if (project?.initialized !== true || project.loading !== false) {
        return undefined;
    }

    return getSettledProjectId();
}
