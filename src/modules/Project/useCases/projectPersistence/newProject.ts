import { logger } from '#/infra/logger/appLogger';
import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { addTrack } from '#/modules/Arrangement/useCases';
import {
    clearRuntimeCachedAudioBuffers,
    forgetProjectLatchedPedals,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import {
    compactProject,
    projectActionHistoryToStore,
    resetCrdtProject,
    startCrdtAutoSave,
} from '#/modules/CrdtDocument/useCases';
import { unloadPlugin as unloadLoadedExternalPlugins } from '#/modules/PluginHost/useCases';
import { ensureTrackStrips, stopPlayback } from '#/modules/Transport/useCases';

import { removeProjectJson } from '../../repositories/project/removeProjectJson';
import { arrangementStore, defaultArrangementStoreState } from '../../stores/arrangementStore';
import { projectLoadFailureStore } from '../../stores/projectLoadFailureStore';
import { projectStore, type ProjectStoreState } from '../../stores/projectStore';
import { createFreshProjectMetadata } from '../createFreshProjectMetadata';

import { setAutoSaveHandle } from './helpers/autoSaveHandle';
import { resetModuleStoresToDefault } from './helpers/resetModuleStoresToDefault';
import {
    projectLoadEpoch,
    type ProjectLoadTransaction,
    runProjectLoadTransaction,
} from './helpers/runProjectLoadTransaction';
import { stopActiveAutoSave } from './helpers/stopActiveAutoSave';

type ActivateNewProjectInput = {
    name: string;
    previousTransientState: Pick<ProjectStoreState, 'initialized' | 'loading'> | null;
    transaction: ProjectLoadTransaction;
};

/** The replacement branch of the reset contract, derived from its callable shape. */
type ReplacedProject = Extract<Awaited<ReturnType<typeof resetCrdtProject>>, { status: 'replaced' }>;

function failNewProjectActivation({
    previousTransientState,
    transaction,
}: Pick<ActivateNewProjectInput, 'previousTransientState' | 'transaction'>): void {
    if (transaction.isCurrent() || transaction.canActivate()) {
        const project = projectStore.value;
        if (project && previousTransientState) {
            projectStore.set({ ...project, ...previousTransientState });
        }
    }
}

/**
 * Publish the failure surface for a throw past the authority switch.
 *
 * Not an abort: the previous project is out of the repository and out of the
 * stores, so restoring the transient flags would present an empty project as a
 * normally opened session, and restarting autosave would compact that empty
 * project over the user's own on disk. Nothing has compacted, so IndexedDB
 * still holds their project and a reload restores it.
 */
function failNewProjectAfterAuthorityReplaced(name: string): void {
    try {
        projectLoadFailureStore.set({
            message: 'Your previous session was closed to create a new project, and the new project failed to open.',
            projectName: name,
        });
    } catch (error) {
        logger.error(new Error('[newProject] Failed to publish the activation failure', { cause: error }));
    }
}

function restorePreviousProjectRuntime(): void {
    try {
        ensureTrackStrips();
    } catch (error) {
        logger.warn('[newProject] Previous audio graph restoration failed:', error);
    }
    try {
        setAutoSaveHandle(startCrdtAutoSave());
    } catch (error) {
        logger.warn('[newProject] Previous autosave restoration failed:', error);
    }
}

/**
 * Tear the previous project down and switch the CRDT authority to a new one.
 *
 * `null` means the previous project is still the live one or its loss has
 * already been published; either way the bookkeeping for that outcome is done
 * and the caller only has to stop.
 */
async function switchToNewProject({
    name,
    previousTransientState,
    transaction,
}: ActivateNewProjectInput): Promise<ReplacedProject | null> {
    let graphTeardownStarted = false;
    let previousPersistenceStopped = false;
    let authorityReplaced = false;
    try {
        if (!(await transaction.prepare()) || !transaction.activate()) {
            failNewProjectActivation({ previousTransientState, transaction });
            return null;
        }

        const releaseRuntimeTransition = await projectLoadEpoch.acquireRuntimeTransition();
        try {
            await stopPlayback();
            if (!transaction.isCurrent()) {
                failNewProjectActivation({ previousTransientState, transaction });
                return null;
            }
            stopActiveAutoSave();
            previousPersistenceStopped = true;
            graphTeardownStarted = true;
            resetAudioGraph();
            await unloadLoadedExternalPlugins();
            if (!transaction.isCurrent()) {
                restorePreviousProjectRuntime();
                failNewProjectActivation({ previousTransientState, transaction });
                return null;
            }
            const reset = await resetCrdtProject(name, () => {
                authorityReplaced = true;
            });
            if (reset.status === 'refused') {
                // Decided before the switch, so nothing was replaced: the
                // previous project is intact and this is an ordinary abort.
                logger.warn(`[newProject] Project reset refused (${reset.reason})`);
                restorePreviousProjectRuntime();
                failNewProjectActivation({ previousTransientState, transaction });
                return null;
            }
            // Point of no return: the fresh project owns the document now, so
            // the old project's latched pedals can no longer be replayed.
            forgetProjectLatchedPedals();
            return reset;
        } finally {
            releaseRuntimeTransition();
        }
    } catch (error) {
        logger.warn('[newProject] Failed to activate project:', error);
        if (authorityReplaced) {
            failNewProjectAfterAuthorityReplaced(name);
            return null;
        }
        if (graphTeardownStarted || previousPersistenceStopped) {
            restorePreviousProjectRuntime();
        }
        failNewProjectActivation({ previousTransientState, transaction });
        return null;
    }
}

/** Populate, publish and make durable the project the authority switch installed. */
async function commitNewProject({
    name,
    finalize,
}: { name: string } & Pick<ReplacedProject, 'finalize'>): Promise<true> {
    let degraded = false;
    function runCommittedStep(step: string, operation: () => void): void {
        try {
            operation();
        } catch (error) {
            degraded = true;
            logger.warn(`[newProject] Committed project activation failed during ${step}:`, error);
        }
    }

    runCommittedStep('action history projection', projectActionHistoryToStore);
    runCommittedStep('module store reset', () => resetModuleStoresToDefault({ createNewMidiProbabilitySeed: true }));
    runCommittedStep('arrangement reset', () => arrangementStore.set(structuredClone(defaultArrangementStoreState)));
    runCommittedStep('master track creation', () => addTrack({ name: 'Master', kind: 'master', select: false }));
    // The reset and master creation enqueue CRDT-backed store writes. Commit them
    // while loading is still true so their terminal projection cannot mark a
    // freshly created project dirty after clean metadata is published.
    runCommittedStep('initial Automerge storage write drain', flushAutomergeStorageWrites);
    let publishedProjectId: string | undefined;
    runCommittedStep('project metadata publication', () => {
        const metadata = createFreshProjectMetadata({
            name,
            loading: false,
            initialized: true,
        });
        publishedProjectId = metadata.projectId;
        projectStore.set({
            ...metadata,
            // Publication barrier: the minted identity is not durable until the
            // initial compaction below persists it. Cleared only on that success.
            identityPersistencePending: true,
        });
    });
    runCommittedStep('project cache removal', removeProjectJson);
    runCommittedStep('runtime audio buffer reset', clearRuntimeCachedAudioBuffers);
    runCommittedStep('undo history reset', clearUndoHistory);

    try {
        await compactProject();
    } catch (error) {
        degraded = true;
        logger.warn('[newProject] Initial CRDT snapshot persistence failed:', error);
    }

    // The reset marker is settled whether or not that snapshot landed: a failed
    // compaction leaves the replacement non-durable, and finalization is what
    // writes that conclusion where the next boot reads it. Autosave stays
    // stopped until it answers, because an autosave compacting this project
    // would race the compare-and-swap deciding whether the reset is kept.
    try {
        const outcome = await finalize();
        if (outcome === 'finalized') {
            runCommittedStep('autosave start', () => setAutoSaveHandle(startCrdtAutoSave()));
            const current = projectStore.value;
            if (current?.identityPersistencePending && current.projectId === publishedProjectId) {
                projectStore.set({ ...current, identityPersistencePending: false });
            }
        } else {
            degraded = true;
            logger.warn(`[newProject] Project reset did not finalize (${outcome}); the project is not durable yet.`);
        }
    } catch (error) {
        degraded = true;
        logger.warn('[newProject] Project reset finalization failed:', error);
    }

    if (degraded) {
        logger.warn('[newProject] Project activated with recovery errors; save before closing.');
    }
    return true;
}

async function activateNewProject(input: ActivateNewProjectInput): Promise<boolean> {
    const replaced = await switchToNewProject(input);
    if (replaced === null) {
        return false;
    }
    return commitNewProject({ name: input.name, finalize: replaced.finalize });
}

export function newProject(name = 'Untitled Project'): Promise<boolean> {
    const transaction = runProjectLoadTransaction();
    const currentProject = projectStore.value;
    const previousTransientState = currentProject
        ? { initialized: currentProject.initialized, loading: currentProject.loading }
        : null;
    if (currentProject) {
        projectStore.set({ ...currentProject, loading: true, initialized: false });
    }
    return activateNewProject({ name, previousTransientState, transaction });
}
