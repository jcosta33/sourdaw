import { executeAppAction } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { countSettledTakes } from '#/modules/Transport/useCases';

import { projectLoadFailureStore } from '../../../stores/projectLoadFailureStore';
import { projectStore } from '../../../stores/projectStore';
import {
    authorizedPreparations,
    ProjectSavePreparationStaleError,
    type SavePreparationIntent,
} from '../../../stores/savePreparationAuthority';
import { buildProjectData } from '../fileIO/buildProjectData';

type SaveAuthority = {
    readonly projectId: string;
    readonly createdAt: number;
    readonly isCurrent: () => boolean;
};

const SAVE_PREPARATION_TIMEOUT_MS = 30_000;
const MAX_SAVE_PREPARATION_ATTEMPTS = 3;

function readCurrentProject(authority: SaveAuthority, signal: AbortSignal) {
    signal.throwIfAborted();
    if (
        !authority.isCurrent() ||
        agentProjectRepairStateStore.value !== null ||
        projectLoadFailureStore.value !== null
    ) {
        throw new Error('Project authority changed during Save preparation');
    }
    const project = projectStore.value;
    if (project?.projectId !== authority.projectId || project.createdAt !== authority.createdAt) {
        throw new Error('Project identity changed during Save preparation');
    }
    if (project.identityMigrationPending) {
        throw new Error('Project Save preparation requires settled project identity');
    }
    return project;
}

async function prepareSaveRevision(authority: SaveAuthority, signal: AbortSignal) {
    const intent: SavePreparationIntent = Object.freeze({ intent: 'prepareSnapshot' });
    const request = { readProject: () => readCurrentProject(authority, signal), initializedLegacyArrangement: false };
    authorizedPreparations.set(intent, request);
    let revision: string | undefined;
    try {
        await executeAppAction(
            { type: 'saveProject', payload: intent },
            {
                signal,
                skipUndo: true,
                skipMacroRecording: true,
                onCommitted: () => {
                    revision = captureProjectRevision();
                },
            }
        );
    } finally {
        authorizedPreparations.delete(intent);
    }
    if (revision === undefined) {
        throw new Error('Project Save preparation did not commit');
    }
    return { revision, initializedLegacyArrangement: request.initializedLegacyArrangement };
}

export async function buildPreparedProjectSaveData(authority: SaveAuthority) {
    const signal = AbortSignal.timeout(SAVE_PREPARATION_TIMEOUT_MS);
    for (let attempt = 0; attempt < MAX_SAVE_PREPARATION_ATTEMPTS; attempt += 1) {
        readCurrentProject(authority, signal);
        let prepared: Awaited<ReturnType<typeof prepareSaveRevision>>;
        try {
            prepared = await prepareSaveRevision(authority, signal);
        } catch (error) {
            if (error instanceof ProjectSavePreparationStaleError) {
                continue;
            }
            throw error;
        }
        readCurrentProject(authority, signal);
        const { revision, initializedLegacyArrangement } = prepared;
        if (initializedLegacyArrangement || captureProjectRevision() !== revision) {
            continue;
        }

        // The take count and snapshot revision must be observed in the same turn.
        const settledTakesAtSnapshot = countSettledTakes();
        const built = await buildProjectData({ includeAudioBuffers: false, preparedRevision: revision });
        readCurrentProject(authority, signal);
        if (captureProjectRevision() !== revision) {
            continue;
        }
        if (!built) {
            throw new Error('Project snapshot could not be built');
        }
        return { built, settledTakesAtSnapshot };
    }
    throw new Error('Project kept changing during Save preparation');
}
