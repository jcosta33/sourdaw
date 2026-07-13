import { logger } from '#/infra/logger/appLogger';
import {
    getAudioContext,
    importCachedAudioBuffers,
    resetAudioGraph,
    restoreCachedAudioBuffersFromIdb,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { projectStore } from '../../stores/projectStore';
import { collectProjectAudioBufferIds } from '../projectPersistence/helpers/collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from '../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { resetModuleStoresToDefault } from '../projectPersistence/helpers/resetModuleStoresToDefault';
import {
    type ProjectLoadTransaction,
    runProjectLoadTransaction,
} from '../projectPersistence/helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../projectPersistence/helpers/verifyAudioBufferReferences';

type PerformRecentProjectLoadInput = {
    key: string;
    transaction: ProjectLoadTransaction;
};

async function performRecentProjectLoad({ key, transaction }: PerformRecentProjectLoadInput): Promise<boolean> {
    try {
        // Reads localStorage first, then falls back to IndexedDB so projects
        // whose localStorage dual-write was dropped on quota stay loadable.
        const raw = await readNamedProjectJson(key);
        if (!raw) {
            logger.warn(`No project data found for key: ${key}`);
            return false;
        }

        const parsed: unknown = JSON.parse(raw);
        if (!isHydratableProjectData(parsed)) {
            logger.warn(`Unsupported project version for key: ${key}`);
            return false;
        }
        const data = parsed;

        if (!transaction.activate()) {
            return false;
        }

        const currentProject = projectStore.value;
        if (currentProject) {
            projectStore.set({ ...currentProject, loading: true });
        }

        const audioContext = getAudioContext();
        const referencedIds = collectProjectAudioBufferIds({ data });
        if (data.audioBuffers) {
            await importCachedAudioBuffers({
                audioContext,
                buffers: data.audioBuffers,
                shouldContinue: transaction.isCurrent,
            });
        }
        if (!transaction.isCurrent()) {
            return false;
        }

        // Restore runtime buffers before publishing the loaded track graph so
        // waveform consumers are ready on the first real track update.
        await restoreCachedAudioBuffersFromIdb({
            audioContext,
            bufferIds: referencedIds,
            shouldContinue: transaction.isCurrent,
        });

        if (!transaction.isCurrent()) {
            return false;
        }

        stopPlayback();
        resetAudioGraph();
        resetModuleStoresToDefault();

        hydrateModuleStoresFromProjectData(data);
        hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true });

        projectStore.set({
            name: data.meta.name,
            createdAt: data.meta.createdAt,
            updatedAt: data.meta.updatedAt,
            keyRoot: data.meta.keyRoot,
            scaleName: data.meta.scaleName,
            tuning: data.meta.tuning,
            dirty: false,
            loading: false,
            initialized: true,
        });

        writeProjectJson(raw);

        verifyAudioBufferReferences();
        clearUndoHistory();

        return true;
    } catch (error) {
        if (transaction.isCurrent()) {
            const currentProject = projectStore.value;
            if (currentProject?.loading) {
                projectStore.set({ ...currentProject, loading: false });
            }
        }
        logger.error(new Error('Failed to load recent project', { cause: error }));
        return false;
    }
}

export function loadRecentProject(key: string): Promise<boolean> {
    return performRecentProjectLoad({
        key,
        transaction: runProjectLoadTransaction(),
    });
}
