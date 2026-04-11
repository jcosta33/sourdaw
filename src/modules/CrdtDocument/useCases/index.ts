export type { DocId, DocumentBundle, MergeResult } from './crdtDocumentTypes';
export { DOC_PREFIX_ROOT, DOC_BRANCHES } from './crdtDocumentTypes';

export {
    createCrdtProject,
    loadCrdtProject,
    persistCrdtProject,
    compactProject,
    hasCrdtProject,
    getPersistenceBackend,
} from './crdtProjectLifecycle';

export { createCrdtDoc } from './createCrdtDoc';
export { getCrdtDoc } from './getCrdtDoc';
export { getCrdtDocIds } from './getCrdtDocIds';
export { hasCrdtDoc } from './hasCrdtDoc';
export { mutateCrdtDoc } from './mutateCrdtDoc';
export type { MutateCrdtDocInput } from './mutateCrdtDoc';

export { projectCrdtToStores, setupProjectionBridge } from './projection/projectProjection';

export { removeCrdtDoc } from './removeCrdtDoc';
export { replaceCrdtDoc } from './replaceCrdtDoc';
export type { ReplaceCrdtDocInput } from './replaceCrdtDoc';

export { restoreSnapshot } from './restoreSnapshot';
export { getDsoSnapshotHandlers } from './getDsoSnapshotHandlers';
export { revertAction, canRevertAction } from './revertAction';
export { saveSnapshot } from './saveSnapshot';
export { setSemanticContext, getSemanticContext, clearSemanticContext } from './semanticChangeContext';
export { startCrdtAutoSave } from './startCrdtAutoSave';
export { subscribeToCrdtChanges } from './subscribeToCrdtChanges';
