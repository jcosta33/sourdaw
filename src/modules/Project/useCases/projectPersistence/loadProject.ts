import { inject } from '#/infra/di/inject';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument';

import { projectStore } from '../../stores/projectStore';
import { clearUndoHistory } from './helpers';

let stopAutoSave: (() => void) | null = null;

export const loadProject = inject({
    loadCrdtProject,
    createCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
    clearUndoHistory,
})(
    ({ loadCrdtProject, createCrdtProject, projectCrdtToStores, startCrdtAutoSave, clearUndoHistory }) =>
        async function loadProject(): Promise<boolean> {
            const current = projectStore.value;
            if (current) {
                projectStore.set({ ...current, loading: true });
            }

            try {
                const loaded = await loadCrdtProject();
                if (!loaded) {
                    await createCrdtProject('Untitled Project');
                }
            } catch (error) {
                console.error('[loadProject] CRDT load failed, creating new project:', error);
                await createCrdtProject('Untitled Project');
            }

            // Hydrate all stores from the Automerge document once.
            // For stores whose keys don't exist in the doc yet (new project),
            // hydrate() writes initialData through to the CRDT.
            projectCrdtToStores();

            // Ensure loading flag is cleared — hydrate may not trigger a notification
            // if the value didn't change, so set it explicitly.
            const project = projectStore.value;
            if (project?.loading) {
                projectStore.set({ ...project, loading: false, initialized: true });
            }

            clearUndoHistory();

            // Start debounced incremental auto-save so edits survive browser crashes.
            // Stop any previous auto-save loop first (e.g. if loadProject is called again).
            if (stopAutoSave) {
                stopAutoSave();
            }
            stopAutoSave = startCrdtAutoSave();

            return true;
        }
);
