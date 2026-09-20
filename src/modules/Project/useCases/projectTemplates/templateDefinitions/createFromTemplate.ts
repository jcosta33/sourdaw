import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { rearmInputMonitoring } from '#/modules/Arrangement/useCases';
import { forgetProjectLatchedPedals, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProject,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { projectStore } from '../../../stores/projectStore';
import { setAutoSaveHandle } from '../../projectPersistence/helpers/autoSaveHandle';
import { markProjectDurabilityPending } from '../../projectPersistence/helpers/markProjectDurabilityPending';
import { resetModuleStoresToDefault } from '../../projectPersistence/helpers/resetModuleStoresToDefault';
import {
    projectLoadEpoch,
    runProjectLoadTransaction,
} from '../../projectPersistence/helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from '../../projectPersistence/helpers/stopActiveAutoSave';

import { templates } from './helpers';

/** The replacement branch of the reset contract, derived from its callable shape. */
type ReplacedProject = Extract<Awaited<ReturnType<typeof resetCrdtProject>>, { status: 'replaced' }>;

function restoreAudioGraph(templateId: string): void {
    try {
        resetAudioGraph();
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to reset graph while recovering "${templateId}":`, error);
    }
    let stripsRestored = false;
    try {
        stripsRestored = ensureTrackStrips().status === 'ready';
    } catch (error) {
        logger.warn(`[createFromTemplate] Failed to rebuild graph while recovering "${templateId}":`, error);
    }
    if (stripsRestored) {
        // The reset above released every monitor capture, so the previous
        // project's 'on' tracks must re-arm against the strips just rebuilt.
        // The law settles every start, so a refusal cannot fail this restore.
        void rearmInputMonitoring(trackStore.value?.tracks ?? []);
    }
}

function restorePersistence(): void {
    try {
        setAutoSaveHandle(startCrdtAutoSave());
    } catch (error) {
        logger.warn('[createFromTemplate] Failed to restart autosave:', error);
    }
}

/**
 * Publish the template's branch list and let autosave run again.
 *
 * Autosave stays stopped until the reset is finalized: until then the template
 * is not the durable project, and a compaction landing in between would move
 * the durable authority past the one the reset recorded, leaving the next boot
 * unable to tell which project the bundle belongs to. The template is published
 * either way, so an unfinalized reset also has to raise the durability barrier
 * — the same one `replaceProjectData` raises — or the workspace presents a
 * project that storage does not hold as a normally opened session.
 */
async function finalizeTemplatePersistence(templateId: string, replaced: ReplacedProject | null): Promise<void> {
    if (replaced === null) {
        return;
    }
    const outcome = await replaced.finalize();
    if (outcome !== 'finalized') {
        markProjectDurabilityPending();
        logger.warn(
            `[createFromTemplate] Project reset did not finalize for "${templateId}" (${outcome}); autosave stays stopped until the next load.`
        );
        return;
    }
    restorePersistence();
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
    let authorityReplaced = false;
    let replaced: ReplacedProject | null = null;
    let releaseRuntimeTransition: (() => void) | null = null;
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
        releaseRuntimeTransition = await projectLoadEpoch.acquireRuntimeTransition();
        await stopPlayback();
        if (!transaction.isCurrent()) {
            logger.info(`[createFromTemplate] superseded during stopPlayback for "${templateId}"`);
            releaseRuntimeTransition();
            return false;
        }
        stopActiveAutoSave();
        persistenceStopped = true;
        graphWasReset = true;
        resetAudioGraph();
        await unloadLoadedExternalPlugins();
        if (!transaction.isCurrent()) {
            restoreAudioGraph(templateId);
            restorePersistence();
            releaseRuntimeTransition();
            return false;
        }
        const reset = await resetCrdtProject(template.name, () => {
            authorityReplaced = true;
        });
        if (reset.status === 'refused') {
            // Decided before the switch, so the previous project is intact and
            // the ordinary abort recovery still applies.
            logger.warn(`[createFromTemplate] Project reset refused for "${templateId}" (${reset.reason})`);
            restoreAudioGraph(templateId);
            restorePersistence();
            releaseRuntimeTransition();
            return false;
        }
        replaced = reset;
        // Point of no return: the template owns the document now, so the
        // previous project's latched pedals can no longer be replayed. Above
        // this line `restoreAudioGraph` still puts the old graph back.
        forgetProjectLatchedPedals();
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
            releaseRuntimeTransition();
            return false;
        }
        // The template's project writes — tracks, selection, metadata — are now
        // committed by the action above. Publish workspace-ready ONLY now, never
        // during the async build (initProject deliberately leaves `initialized`
        // false), so a track the user clicks the instant the workspace paints is
        // not clobbered by a late template write (CC-10). Monotonic per #687: this
        // is the single ready latch on the template path and is never un-set.
        const readyProject = projectStore.value;
        if (readyProject) {
            projectStore.set({ ...readyProject, loading: false, initialized: true });
        }
        await compactProject();
        await finalizeTemplatePersistence(templateId, replaced);
        releaseRuntimeTransition();
        return true;
    } catch (error) {
        // Past the authority switch there is nothing to restore: the previous
        // project is out of the stores, and restarting autosave would compact
        // the half-built template over it on disk.
        if (graphWasReset && !authorityReplaced) {
            restoreAudioGraph(templateId);
        }
        if (persistenceStopped && !authorityReplaced) {
            restorePersistence();
        }
        releaseRuntimeTransition?.();
        // The reset marker is settled on every path past the switch. A failed
        // build leaves the replacement non-durable and finalization is what
        // records that where the next boot reads it; a build whose writes did
        // commit is the project the user keeps, so its branch list has to
        // become durable and autosave has to protect it from here.
        await finalizeTemplatePersistence(templateId, replaced);
        if (isAppActionCommittedError(error)) {
            logger.warn(`[createFromTemplate] Template "${templateId}" committed with recovery errors:`, error);
            return true;
        }
        logger.warn(`[createFromTemplate] Failed to create template "${templateId}":`, error);
        return false;
    }
}
