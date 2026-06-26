import { logger } from '#/infra/logger/appLogger';
import { clearUndoHistory } from '#/modules/Command/stores';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';

import { setAutoSaveHandle, stopActiveAutoSave } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';

export async function loadProject(): Promise<boolean> {
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
        logger.warn('[loadProject] CRDT load failed, creating new project:', error);
        await createCrdtProject('Untitled Project');
    }

    // Reset per-device-instance stores (§13.1) before hydration so stale device
    // state from a previously open project does not leak into the loaded one. The
    // CRDT document does not persist the device stores, so this is the only point
    // that returns them to default on the CRDT-load path.
    resetModuleStoresToDefault();

    // Hydrate all stores from the Automerge document once.
    // For stores whose keys don't exist in the doc yet (new project),
    // hydrate() writes initialData through to the CRDT.
    projectCrdtToStores();

    // Run data migrations on loaded stores.
    migrateAbsoluteMidiNotes();

    // Ensure loading flag is cleared — hydrate may not trigger a notification
    // if the value didn't change, so set it explicitly.
    const project = projectStore.value;
    if (project?.loading) {
        projectStore.set({ ...project, loading: false, initialized: true });
    }

    clearUndoHistory();

    // Start debounced incremental auto-save so edits survive browser crashes.
    // Stop any previous auto-save loop first (e.g. if loadProject is called again).
    stopActiveAutoSave();
    setAutoSaveHandle(startCrdtAutoSave());

    return true;
}
