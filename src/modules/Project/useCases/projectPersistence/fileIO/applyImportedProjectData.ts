import {
    getAudioContext,
    importCachedAudioBuffers,
    prepareCachedAudioBuffersFromIdb,
    resetAudioGraph,
} from '#/modules/AudioEngine/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { stopPlayback } from '#/modules/Transport/useCases';

import { projectStore } from '../../../stores/projectStore';
import { collectProjectAudioBufferIds } from '../helpers/collectProjectAudioBufferIds';
import { hydrateArrangementStoreFromProjectData } from '../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../helpers/hydrateModuleStoresFromProjectData';
import { type HydratableProjectData, isHydratableProjectData } from '../helpers/isHydratableProjectData';
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

    const currentProject = projectStore.value;
    if (currentProject) {
        projectStore.set({ ...currentProject, loading: true });
    }

    // Restore referenced runtime buffers before publishing the imported track
    // graph. Track subscribers can render waveforms from their first update,
    // without a synthetic track-store write after hydration.
    const audioContext = getAudioContext();
    const referencedIds = collectProjectAudioBufferIds({ data });
    const embeddedBufferIds = new Set(Object.keys(data.audioBuffers ?? {}));
    const preparedEmbeddedBuffers = data.audioBuffers
        ? importCachedAudioBuffers({
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

    if (!preparedStoredBuffers || !transaction.isCurrent()) {
        return false;
    }

    // Preparation is complete and this transition still owns commit authority.
    // Replace the live project synchronously so no partial reset is observable.
    preparedStoredBuffers.publish();
    preparedEmbeddedBuffers?.publish();
    stopPlayback();
    resetAudioGraph();
    resetModuleStoresToDefault();

    // 1. Hydrate core module stores
    hydrateModuleStoresFromProjectData(data);

    // 2. Hydrate Project Store (Meta & Tuning)
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

    // The current schema still collapses imported projects to one arrangement;
    // the Project owner publishes that snapshot from the same hydrated tracks.
    hydrateArrangementStoreFromProjectData({ data, preserveSavedArrangements: true });

    verifyAudioBufferReferences();
    clearUndoHistory();
    return true;
}

type ApplyImportedProjectDataInput = {
    data: unknown;
    transaction?: ProjectLoadTransaction;
};

export function applyImportedProjectData({ data, transaction }: ApplyImportedProjectDataInput): Promise<boolean> {
    if (!isHydratableProjectData(data)) {
        return Promise.resolve(false);
    }
    return performImportedProjectDataApplication({
        data,
        transaction: transaction ?? runProjectLoadTransaction(),
    });
}
