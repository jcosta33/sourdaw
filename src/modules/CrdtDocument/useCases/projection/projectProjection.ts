import { resetAutomergeStorageProjections } from '#/infra/store/storage/createAutomergeStorage';

import { agentProjectRepairStateStore } from '../../stores/agentProjectRepairStateStore';
import { DOC_PREFIX_ROOT } from '../crdtDocumentTypes';
import { inspectCurrentAgentProjectRepairState } from '../inspectCurrentAgentProjectRepairState';

import { projectSlotProjections } from './projectSlotProjections';

/**
 * Re-project every root slot from the document into its store.
 *
 * Used for bulk and document-origin changes (load, merge, sync, snapshot
 * restore), where the set of keys that moved is not knowable. A change that a
 * local CRDT-backed store performed names its slots and goes through
 * `projectChangedCrdtSlots` instead.
 *
 * A full project load resets projections first so local default writes used to
 * clear transient module state cannot rebase over the newly loaded authority.
 */
type ProjectCrdtToStoresInput = {
    resetProjections?: boolean;
};

export function projectCrdtToStores({ resetProjections = false }: ProjectCrdtToStoresInput = {}): void {
    if (resetProjections) {
        resetAutomergeStorageProjections(DOC_PREFIX_ROOT);
    }
    const repairState = inspectCurrentAgentProjectRepairState();
    agentProjectRepairStateStore.set(repairState);
    if (repairState) {
        return;
    }
    for (const projection of projectSlotProjections) {
        projection.hydrate();
    }
}
