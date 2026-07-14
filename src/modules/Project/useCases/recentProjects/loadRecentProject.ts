import { logger } from '#/infra/logger/appLogger';
import { batchStoreUpdates } from '#/infra/store/createStore';
import {
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { createCrdtProject } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { readNamedProjectJson, writeProjectJson } from '../../repositories/project/storageOperations';
import { projectStore } from '../../stores/projectStore';
import { collectProjectAudioBufferIds } from '../projectPersistence/helpers/collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from '../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../projectPersistence/helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../projectPersistence/helpers/normalizeLegacyProjectData';
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
        const normalizedData = normalizeLegacyProjectData(parsed);
        if (!isHydratableProjectData(normalizedData)) {
            logger.warn(`Unsupported project version for key: ${key}`);
            return false;
        }
        const data = normalizedData;

        if (!transaction.activate()) {
            return false;
        }

        const audioContext = getAudioContext();
        const referencedIds = collectProjectAudioBufferIds({ data });
        const embeddedBufferIds = new Set(Object.keys(data.audioBuffers ?? {}));
        const preparedEmbeddedBuffers = data.audioBuffers
            ? await importCachedAudioBuffers({
                  audioContext,
                  buffers: data.audioBuffers,
                  cacheIds: referencedIds,
                  shouldContinue: transaction.isCurrent,
              })
            : undefined;
        if (data.audioBuffers && !preparedEmbeddedBuffers) {
            return false;
        }

        // Restore runtime buffers before publishing the loaded track graph so
        // waveform consumers are ready on the first real track update.
        const preparedStoredBuffers = await prepareCachedAudioBuffersFromIdb({
            audioContext,
            bufferIds: referencedIds.filter((id) => !embeddedBufferIds.has(id)),
            shouldContinue: transaction.isCurrent,
        });

        if (!preparedStoredBuffers) {
            return false;
        }
        if (preparedEmbeddedBuffers && !(await preparedEmbeddedBuffers.persist())) {
            return false;
        }
        if (!transaction.isCurrent()) {
            return false;
        }

        const crdtReset = batchStoreUpdates(() => {
            const reset = createCrdtProject(data.meta.name);
            preparedStoredBuffers.publish();
            preparedEmbeddedBuffers?.publish();
            stopPlayback();
            resetAudioGraph();
            resetModuleStoresToDefault();

            hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true });
            hydrateModuleStoresFromProjectData(data);

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

            writeProjectJson(JSON.stringify(data));
            verifyAudioBufferReferences();
            clearUndoHistory();
            return reset;
        });
        void crdtReset.catch((error: unknown) => {
            logger.warn('[loadRecentProject] Failed to persist loaded CRDT authority:', error);
        });

        return true;
    } catch (error) {
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
