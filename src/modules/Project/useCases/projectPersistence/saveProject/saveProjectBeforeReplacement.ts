import { projectStore } from '../../../stores/projectStore';

import { saveProject } from './saveProject';

/**
 * Run the pre-switch save a project-replacing route owes the open project, and
 * report whether the replacement may proceed.
 *
 * A save can resolve `true` while the project is still dirty: a plugin state
 * capture rejected before commit warns the user, leaves that edit out of the
 * persisted truth, and holds the dirty flag so the next save retries (issue
 * #3694). Replacing the project over it would destroy the edit exactly as a
 * failed save would, so the refusal covers both. It stays silent — the
 * capture's warning or the save-failure surface has already said why.
 */
export async function saveProjectBeforeReplacement(): Promise<boolean> {
    const saved = await saveProject();
    return saved && projectStore.value?.dirty !== true;
}
