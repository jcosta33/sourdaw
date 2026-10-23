import { waitForClosedTakes } from '#/modules/Transport/useCases';

import { projectStore } from '../../../stores/projectStore';

import { saveProjectBeforeReplacement } from './saveProjectBeforeReplacement';

/**
 * The pre-switch save of a route that has already run `saveProjectBeforeReplacement`
 * and then awaited a read (a chosen file) before it replaces the project: only
 * edits made since, a take a Stop landed among them, are worth saving again.
 * Whether the project is edited is decided after the wait for closing takes,
 * because a take dirties the project only when its commit lands.
 */
export async function saveEditedProjectBeforeReplacement(): Promise<boolean> {
    await waitForClosedTakes();
    return projectStore.value?.dirty !== true || saveProjectBeforeReplacement();
}
