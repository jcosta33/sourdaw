// presentations/views
export { BranchManagerDialog } from './presentations/views/BranchManagerDialog';

// stores/actionHistoryStore
export { actionHistoryStore, pushActionHistoryEntry, markEntryReverted, clearActionHistory } from './stores/actionHistoryStore';
export type { ActionHistoryEntry, ActionHistoryState } from './stores/actionHistoryStore';

// stores/branchStore
export { branchStore } from './stores/branchStore';

// useCases/crdtDocumentTypes
export type { DocId, DocumentBundle, MergeResult } from './useCases/crdtDocumentTypes';
export { DOC_PREFIX_ROOT, DOC_BRANCHES } from './useCases/crdtDocumentTypes';

// useCases/crdtProjectLifecycle
export {
    createCrdtProject,
    loadCrdtProject,
    persistCrdtProject,
    compactProject,
    hasCrdtProject,
    getPersistenceBackend,
} from './useCases/crdtProjectLifecycle';

// useCases/createCrdtDoc
export { createCrdtDoc } from './useCases/createCrdtDoc';

// useCases/getCrdtDoc
export { getCrdtDoc } from './useCases/getCrdtDoc';

// useCases/getCrdtDocIds
export { getCrdtDocIds } from './useCases/getCrdtDocIds';

// useCases/hasCrdtDoc
export { hasCrdtDoc } from './useCases/hasCrdtDoc';

// useCases/mutateCrdtDoc
export { mutateCrdtDoc } from './useCases/mutateCrdtDoc';
export type { MutateCrdtDocInput } from './useCases/mutateCrdtDoc';

// useCases/projection/projectProjection
export { projectCrdtToStores, setupProjectionBridge } from './useCases/projection/projectProjection';

// useCases/removeCrdtDoc
export { removeCrdtDoc } from './useCases/removeCrdtDoc';

// useCases/replaceCrdtDoc
export { replaceCrdtDoc } from './useCases/replaceCrdtDoc';
export type { ReplaceCrdtDocInput } from './useCases/replaceCrdtDoc';

// useCases/restoreSnapshot
export { restoreSnapshot } from './useCases/restoreSnapshot';

// useCases/revertAction
export { revertAction, canRevertAction } from './useCases/revertAction';

// useCases/saveSnapshot
export { saveSnapshot } from './useCases/saveSnapshot';

// useCases/semanticChangeContext
export { setSemanticContext, getSemanticContext, clearSemanticContext } from './useCases/semanticChangeContext';

// useCases/startCrdtAutoSave
export { startCrdtAutoSave } from './useCases/startCrdtAutoSave';

// useCases/subscribeToCrdtChanges
export { subscribeToCrdtChanges } from './useCases/subscribeToCrdtChanges';
