import { logger } from '#/infra/logger/appLogger';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProjectAuthority,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { setAutoSaveHandle } from '../../projectPersistence/helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import { runProjectLoadTransaction } from '../../projectPersistence/helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from '../../projectPersistence/helpers/stopActiveAutoSave';

import { templates } from './helpers';

function restoreAudioGraph(templateId: string): void {
    try {
        resetAudioGraph();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to reset graph while recovering "${templateId}":`, error);
    }
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to rebuild graph while recovering "${templateId}":`, error);
    }
}

function restorePersistence(): void {
    try {
        setAutoSaveHandle(startCrdtAutoSave());
    } catch (error) {
        logger.warn('[createFromTemplate] Failed to restart autosave:', error);
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
        if (!(await transaction.prepare()) || !transaction.activate()) {
            return false;
        }
        await stopPlayback();
        graphWasReset = true;
        stopActiveAutoSave();
        persistenceStopped = true;
        resetAudioGraph();
        resetCrdtProjectAuthority(template.name);
        projectActionHistoryToStore();
        resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true });
        clearUndoHistory();
        await executeAppAction(
            { type: 'createProjectFromTemplate', payload: { templateId } },
            { skipMacroRecording: true }
        );
        restorePersistence();
        await compactProject();
        return true;
    } catch (error) {
        if (graphWasReset) {
            restoreAudioGraph(templateId);
        }
        if (persistenceStopped) {
            restorePersistence();
        }
        if (isAppActionCommittedError(error)) {
            logger.warn(`[createFromTemplate] Template "${templateId}" committed with recovery errors:`, error);
            return true;
        }
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
