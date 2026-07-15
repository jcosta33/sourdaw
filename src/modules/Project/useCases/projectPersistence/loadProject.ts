import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { getAudioContext, prepareCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    createCrdtProject,
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { collectTrackStateAudioBufferIds } from './helpers/collectTrackStateAudioBufferIds';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export async function loadProject(): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    transaction.activate();

    try {
        const loaded = await loadCrdtProject({ shouldCommit: transaction.isCurrent });
        if (!transaction.isCurrent()) {
            return false;
        }
        if (!loaded) {
            await createCrdtProject('Untitled Project');
        }
    } catch (error) {
        if (!transaction.isCurrent()) {
            return false;
        }
        logger.error(new Error('[loadProject] CRDT load failed; preserving persisted project', { cause: error }));
        throw error;
    }

    if (!transaction.isCurrent()) {
        return false;
    }

    const rootDoc = getCrdtDoc<{ tracks?: unknown }>(DOC_PREFIX_ROOT);
    const referencedBufferIds = collectTrackStateAudioBufferIds(rootDoc?.tracks);
    const preparedBuffers = await prepareCachedAudioBuffersFromIdb({
        audioContext: getAudioContext(),
        bufferIds: referencedBufferIds,
        shouldContinue: transaction.isCurrent,
    });
    if (!preparedBuffers || !transaction.isCurrent()) {
        return false;
    }

    batchStoreUpdates(() => {
        preparedBuffers.publish();
        // Reset per-device-instance stores (§13.1) before hydration so stale
        // device state from a previously open project cannot leak into it.
        resetModuleStoresToDefault();
        projectCrdtToStores();
        migrateAbsoluteMidiNotes();

        const project = projectStore.value;
        if (project?.loading) {
            projectStore.set({ ...project, loading: false, initialized: true });
        }
        clearUndoHistory();
    });

    if (!transaction.isCurrent()) {
        return false;
    }

    // Start debounced incremental auto-save so edits survive browser crashes.
    // Stop any previous auto-save loop first (e.g. if loadProject is called again).
    stopActiveAutoSave();
    setAutoSaveHandle(startCrdtAutoSave());

    return true;
}
