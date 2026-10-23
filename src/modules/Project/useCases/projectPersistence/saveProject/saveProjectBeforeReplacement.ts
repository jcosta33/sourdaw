import { waitForClosedTakes, watchClosedTakes } from '#/modules/Transport/useCases';

import { projectStore } from '../../../stores/projectStore';

import { saveProject } from './saveProject';

/**
 * Run the pre-switch save a project-replacing route owes the open project, and
 * report whether the replacement may proceed.
 *
 * A user's Stop turns the transport idle at once and lands the take's commit
 * afterwards, so the save first waits for every take that is still closing, and
 * saves again whenever one lands while a save is running: the take is the open
 * project's, and the replacement that follows must find it already kept. This
 * is where the guarantee that a take is never lost silently starts for the
 * routes that open another project after the user's gesture; the replacement
 * itself keeps the takes that close after this returns.
 *
 * A save can resolve `true` while the project is still dirty: a plugin state
 * capture rejected before commit warns the user, leaves that edit out of the
 * persisted truth, and holds the dirty flag so the next save retries (issue
 * #3694). Replacing the project over it would destroy the edit exactly as a
 * failed save would, so the refusal covers both. It stays silent — the
 * capture's warning or the save-failure surface has already said why.
 */
export async function saveProjectBeforeReplacement(): Promise<boolean> {
    let takeLanded: boolean;
    do {
        await waitForClosedTakes();
        const closedTakes = watchClosedTakes();
        if (!(await saveProject())) {
            return false;
        }
        await waitForClosedTakes();
        takeLanded = closedTakes.hasClosedTake();
    } while (takeLanded);
    return projectStore.value?.dirty !== true;
}
