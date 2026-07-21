import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { getAudioContext, prepareCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    loadCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';
import { finishProjectLoading } from '../finishProjectLoading';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { collectTrackStateAudioBufferIds } from './helpers/collectTrackStateAudioBufferIds';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export async function loadProject(): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return false;
        }
    } catch (error) {
        logger.error(new Error('Failed to end collaboration before loading project', { cause: error }));
        return false;
    }

    try {
        const loaded = await loadCrdtProject({ shouldCommit: transaction.isCurrent });
        if (!transaction.isCurrent()) {
            return false;
        }
        if (!loaded) {
            // No persisted project (fresh profile): clear the loading state and
            // land on the LaunchScreen (initialized stays false) instead of
            // silently auto-creating a project. New / template / demo selections
            // run the unified createCrdtProject path from the launch flow.
            finishProjectLoading();
            return false;
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
        resetModuleStoresToDefault({ resetGrooveTemplates: false, resetMidiState: false, resetYeastState: false });
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
