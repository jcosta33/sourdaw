import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases';

import { createProjectId, isCanonicalProjectId } from '../../models/ProjectData';
import { projectStore } from '../../stores/projectStore';

/**
 * Give one projected legacy project a durable canonical identity.
 *
 * Projection itself remains read-only and may expose an absent identity. This
 * explicit load/save seam mints once, commits the store write into the active
 * Automerge document, and persists that document before a version-2 snapshot
 * or canonical address can be published.
 */
export async function migrateActiveProjectIdentity(): Promise<boolean> {
    const project = projectStore.value;
    if (!project || isCanonicalProjectId(project.projectId)) {
        return false;
    }

    projectStore.set({ ...project, projectId: createProjectId() });
    flushAutomergeStorageWrites();
    await persistCrdtProject();
    return true;
}
