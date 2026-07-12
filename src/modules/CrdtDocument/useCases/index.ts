export { DOC_PREFIX_ROOT, DOC_BRANCHES } from './crdtDocumentTypes';

export { compactProject } from './compactProject';
export { createCrdtProject } from './createCrdtProject';
export { getPersistenceBackend } from './crdtProjectLifecycle';
export { hasCrdtProject } from './hasCrdtProject';
export { loadCrdtProject } from './loadCrdtProject';
export { persistCrdtProject } from './persistCrdtProject';

export { createCrdtDoc } from './createCrdtDoc';
export { clearActionHistory } from './clearActionHistory';
export { markActionHistoryEntryReverted } from './markActionHistoryEntryReverted';
export { recordActionHistoryEntry } from './recordActionHistoryEntry';
export { getCrdtDoc } from './getCrdtDoc';
export { getCrdtDocIds } from './getCrdtDocIds';
export { hasCrdtDoc } from './hasCrdtDoc';
export { mutateCrdtDoc } from './mutateCrdtDoc';
export type { MutateCrdtDocInput } from './mutateCrdtDoc';

export { projectCrdtToStores } from './projection/projectProjection';
export { projectActionHistoryToStore } from './projection/projectActionHistoryToStore';
export { setupProjectionBridge } from './projection/setupProjectionBridge';

export { removeCrdtDoc } from './removeCrdtDoc';
export { replaceCrdtDoc } from './replaceCrdtDoc';
export type { ReplaceCrdtDocInput } from './replaceCrdtDoc';

export { restoreSnapshot } from './restoreSnapshot';
export { getDsoSnapshotHandlers } from './getDsoSnapshotHandlers';
export { registerCrdtStorageRuntime } from './registerCrdtStorageRuntime';
export { saveSnapshot } from './saveSnapshot';
export { transactSnapshot } from './transactSnapshot';
export { startCrdtAutoSave } from './startCrdtAutoSave';
export { subscribeToCrdtChanges } from './subscribeToCrdtChanges';
