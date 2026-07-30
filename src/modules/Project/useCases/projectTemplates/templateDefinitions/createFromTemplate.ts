import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectStore } from '../../../stores/projectStore';
import { setAutoSaveHandle } from '../../projectPersistence/helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../../projectPersistence/helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from '../../projectPersistence/helpers/stopActiveAutoSave';

import { templates } from './helpers';

function restoreAudioGraph(templateId: string): boolean {
    let restored = true;
    try {
        resetAudioGraph();
    } catch (error) {
        restored = false;
        logger.warn(`[createFromTemplate] Failed to reset graph while recovering "${templateId}":`, error);
    }
    try {
        ensureTrackStrips();
    } catch (error) {
        restored = false;
        logger.warn(`[createFromTemplate] Failed to rebuild graph while recovering "${templateId}":`, error);
    }
    return restored;
}

function restorePersistence(): void {
    try {
        setAutoSaveHandle(startCrdtAutoSave());
    } catch (error) {
        logger.warn('[createFromTemplate] Failed to restart autosave:', error);
    }
}

async function completeCommittedTemplate(templateId: string): Promise<void> {
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to build committed graph for "${templateId}":`, error);
        if (!restoreAudioGraph(templateId)) {
            notifyUser('Project opened, but its audio graph could not be restored. Reload before playback.', 'warning');
        }
    }

    // Workspace-ready means project truth is committed and graph construction
    // has started. Device/content playable-readiness is a separate AudioEngine
    // boundary and must be transition-scoped before it can gate transport.
    const readyProject = projectStore.value;
    if (readyProject) {
        projectStore.set({ ...readyProject, loading: false, initialized: true });
    }
    restorePersistence();
    try {
        await compactProject();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to persist initial snapshot for "${templateId}":`, error);
        notifyUser(
            'Project opened, but its initial snapshot could not be saved. Save a copy before closing.',
            'warning'
        );
    }
}

export async function createFromTemplate(templateId: string): Promise<boolean> {
    const template = templates.find((time) => time.id === templateId);
    if (!template) {
        return false;
    }
    if (template.executionBoundary === 'project-replacement') {
        return await template.create();
    }

    // Template creation REPLACES the open project, so it must run the same
    // transition machinery as newProject: collab leave + replay-authority
    // reset via the transaction, autosave stop, graph teardown, fresh CRDT
    // authority, full module-store reset (MIDI notes, automation, tempo maps,
    // sidechain routes, device stores), and undo-history clear — otherwise the
    // previous project's state leaks into every template (audit #568 F1).
    const transaction = runProjectLoadTransaction();
    let graphWasReset = false;
    let persistenceStopped = false;
    try {
        const prepared = await transaction.prepare();
        const activated = prepared ? transaction.activate() : false;
        if (!prepared || !activated) {
            // Every false return here silently kicks the user back to the
            // LaunchScreen with a generic toast — without this line the field
            // has no way to tell WHICH rejection fired (found chasing an
            // intermittent template-launch failure under load).
            logger.warn(
                `[createFromTemplate] transition rejected for "${templateId}" (prepared=${String(prepared)}, activated=${String(activated)})`
            );
            return false;
        }
        await stopPlayback();
        if (!transaction.isCurrent()) {
            logger.info(`[createFromTemplate] superseded during stopPlayback for "${templateId}"`);
            // Superseded mid-flight: the successor transition owns the project
            // now — no teardown, no persistence touch (mirror newProject).
            return false;
        }
        stopActiveAutoSave();
        persistenceStopped = true;
        graphWasReset = true;
        resetAudioGraph();
        resetCrdtProjectAuthority(template.name);
        projectActionHistoryToStore();
        resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true });
        // Commit the teardown baseline before the async rebuild action runs.
        // resetModuleStoresToDefault writes an empty tracks slot to the
        // CRDT-backed trackStore OUTSIDE the executeAppAction transaction, so it
        // schedules an unscoped requestAnimationFrame flush. Because the template
        // handler is async, that deferred empty write can land AFTER the rebuilt
        // tracks are set, reverting the projection to zero tracks (the workspace
        // then shows an empty "Untitled Project"). Flushing here commits the empty
        // baseline now, so no stale write survives to overwrite the built project.
        flushAutomergeStorageWrites();
        clearUndoHistory();
        await executeAppAction(
            { type: 'createProjectFromTemplate', payload: { templateId } },
            { skipMacroRecording: true }
        );
        if (!transaction.isCurrent()) {
            logger.info(`[createFromTemplate] superseded during the template action for "${templateId}"`);
            // Superseded while the template action ran: the successor owns
            // persistence — do not restart autosave or compact here.
            return false;
        }
        await completeCommittedTemplate(templateId);
        return true;
    } catch (error) {
        if (!transaction.isCurrent()) {
            logger.info(`[createFromTemplate] superseded after a template failure for "${templateId}"`);
            return false;
        }
        if (isAppActionCommittedError(error)) {
            logger.warn(`[createFromTemplate] Template "${templateId}" committed with recovery errors:`, error);
            await completeCommittedTemplate(templateId);
            return true;
        }
        if (graphWasReset) {
            restoreAudioGraph(templateId);
        }
        if (persistenceStopped) {
            restorePersistence();
        }
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
