import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import { getAudioContext, prepareCachedAudioBuffersFromIdb } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import {
    DOC_PREFIX_ROOT,
    getCrdtDoc,
    loadCrdtProject,
    persistCrdtProject,
    projectCrdtToStores,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { migrateAbsoluteMidiNotes, readLegacyChordTrackMigration } from '#/modules/MIDI/useCases';

import { projectStore } from '../../stores/projectStore';
import { finishProjectLoading } from '../finishProjectLoading';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { collectTrackStateAudioBufferIds } from './helpers/collectTrackStateAudioBufferIds';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

export async function loadProject(): Promise<boolean> {
    // Boot restore is subordinate: if the user picked a project on the
    // LaunchScreen while `initializeAudioEngine()` was resolving, that
    // transition is already preparing and must win. Yield to any mid-flight
    // transition rather than superseding it with the implicit startup restore.
    const transaction = runProjectLoadTransaction({ yieldToInFlight: true });
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

    const rootDoc = getCrdtDoc<{ chordTrack?: unknown; tracks?: unknown }>(DOC_PREFIX_ROOT);
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
        // Reset in-memory module/device state, then discard the reset writes at
        // the projection boundary before hydrating the newly loaded authority.
        resetModuleStoresToDefault({ resetGrooveTemplates: false, resetMidiState: false, resetYeastState: false });
        projectCrdtToStores({ resetProjections: true });
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

    if (rootDoc && !Object.hasOwn(rootDoc, 'chordTrack')) {
        const migration = readLegacyChordTrackMigration();
        if (migration) {
            await executeAppAction(migration.action, {
                shouldExecute: transaction.isCurrent,
                skipMacroRecording: true,
                skipUndo: true,
            });
            if (!transaction.isCurrent()) {
                return false;
            }
            await persistCrdtProject();
            if (!transaction.isCurrent()) {
                return false;
            }
            migration.remove();
        }
    }

    // Start debounced incremental auto-save so edits survive browser crashes.
    // Stop any previous auto-save loop first (e.g. if loadProject is called again).
    stopActiveAutoSave();
    setAutoSaveHandle(startCrdtAutoSave());

    return true;
}
