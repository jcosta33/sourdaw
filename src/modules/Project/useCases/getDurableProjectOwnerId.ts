import { projectStore } from '../stores/projectStore';

import { isSemanticProjectIdentityReady } from './semanticProjectIndex';

export function getDurableProjectOwnerId(): string | undefined {
    const project = projectStore.value;
    if (!project?.initialized || !isSemanticProjectIdentityReady(project)) {
        return undefined;
    }

    return project.projectId;
}
