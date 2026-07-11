import { logger } from '#/infra/logger/appLogger';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';

import { beginProjectIdentityTransition } from './beginProjectIdentityTransition';
import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export async function loadProject(): Promise<boolean> {
    const transition = beginProjectIdentityTransition();

    try {
        const loaded = await loadCrdtProject({ canActivate: transition.isCurrent });
        if (!transition.isCurrent()) {
            return false;
        }
        if (!loaded) {
            const activated = await createCrdtProject({
                name: 'Untitled Project',
                canActivate: transition.isCurrent,
            });
            if (!activated || !transition.isCurrent()) {
                return false;
            }
        }
    } catch (error) {
        if (!transition.isCurrent()) {
            return false;
        }
        logger.warn('[loadProject] CRDT load failed, creating new project:', error);
        const activated = await createCrdtProject({ name: 'Untitled Project', canActivate: transition.isCurrent });
        if (!activated || !transition.isCurrent()) {
            return false;
        }
    }

    if (!transition.isCurrent() || !transition.complete()) {
        return false;
    }
    if (!transition.isCurrent()) {
        return false;
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
    if (project && transition.isCurrent()) {
        projectStore.set({ ...project, loading: false, initialized: true });
    }

    if (!transition.isCurrent()) {
        return false;
    }
    clearUndoHistory();

    // Start debounced incremental auto-save so edits survive browser crashes.
    // Stop any previous auto-save loop first (e.g. if loadProject is called again).
    stopActiveAutoSave();
    if (!transition.isCurrent()) {
        return false;
    }
    setAutoSaveHandle(startCrdtAutoSave());

    return true;
}
