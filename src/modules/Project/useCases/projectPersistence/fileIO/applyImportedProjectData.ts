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

import { projectStore } from '../../../stores/projectStore';
import { collectProjectAudioBufferIds } from '../helpers/collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from '../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { type HydratableProjectData, isHydratableProjectData } from '../helpers/isHydratableProjectData';
import { normalizeLegacyProjectData } from '../helpers/normalizeLegacyProjectData';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { type ProjectLoadTransaction, runProjectLoadTransaction } from '../helpers/runProjectLoadTransaction';
import { verifyAudioBufferReferences } from '../helpers/verifyAudioBufferReferences';

type PerformImportedProjectDataApplicationInput = {
    data: HydratableProjectData;
    transaction: ProjectLoadTransaction;
};

async function performImportedProjectDataApplication({
    data,
    transaction,
}: PerformImportedProjectDataApplicationInput): Promise<boolean> {
    if (!transaction.activate()) {
        return false;
    }

    // Restore referenced runtime buffers before publishing the imported track
    // graph. Track subscribers can render waveforms from their first update,
    // without a synthetic track-store write after hydration.
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

    // Preparation is complete and this transition still owns commit authority.
    // Replace the live project synchronously so no partial reset is observable.
    const crdtReset = batchStoreUpdates(() => {
        const reset = createCrdtProject(data.meta.name);
        preparedStoredBuffers.publish();
        preparedEmbeddedBuffers?.publish();
        stopPlayback();
        resetAudioGraph();
        resetModuleStoresToDefault();

        // Publish the saved arrangement catalog and its active live snapshot.
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

        verifyAudioBufferReferences();
        clearUndoHistory();
        return reset;
    });
    void crdtReset.catch((error: unknown) => {
        logger.warn('[applyImportedProjectData] Failed to persist imported CRDT authority:', error);
    });
    return true;
}

type ApplyImportedProjectDataInput = {
    data: unknown;
    transaction?: ProjectLoadTransaction;
};

export function applyImportedProjectData({ data, transaction }: ApplyImportedProjectDataInput): Promise<boolean> {
    const normalizedData = normalizeLegacyProjectData(data);
    if (!isHydratableProjectData(normalizedData)) {
        return Promise.resolve(false);
    }
    return performImportedProjectDataApplication({
        data: normalizedData,
        transaction: transaction ?? runProjectLoadTransaction(),
    });
}
