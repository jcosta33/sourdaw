export { DOC_PREFIX_ROOT, DOC_BRANCHES } from './crdtDocumentTypes';

export { compactProject } from './compactProject';
export { captureProjectRevision } from './captureProjectRevision';
export { createCommandPreviewWorkspace } from './createCommandPreviewWorkspace';
export { captureActiveBranchReference } from './captureActiveBranchReference';
export { getDrumPreviewBranchHandlers } from './getDrumPreviewBranchHandlers';
export { isDrumPreviewBranchPlanApplied } from './crdtBranching/isDrumPreviewBranchPlanApplied';
export { waitForCrdtDocumentTransition } from './waitForCrdtDocumentTransition';
export { createCrdtProject } from './createCrdtProject';
export { getPersistenceBackend } from './crdtProjectLifecycle';
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

export { projectCrdtToStores } from './projection/projectProjection';
export { projectActionHistoryToStore } from './projection/projectActionHistoryToStore';
export { setupProjectionBridge } from './projection/setupProjectionBridge';

export { removeCrdtDoc } from './removeCrdtDoc';
export { resetCrdtProjectAuthority } from './resetCrdtProjectAuthority';
export { replaceCrdtDoc } from './replaceCrdtDoc';
export { sanitizeIncomingCrdtDocument } from './sanitizeIncomingCrdtDocument';
export { initBranchState } from './initBranchState';
export { preserveBranchStateForSession } from './preserveBranchStateForSession';
export { replaceBranchState } from './replaceBranchState';
export { restoreBranchStateAfterSession } from './restoreBranchStateAfterSession';

export { registerCrdtStorageRuntime } from './registerCrdtStorageRuntime';
export { transactSnapshot } from './transactSnapshot';
export { startCrdtAutoSave } from './startCrdtAutoSave';
export { subscribeToCrdtChanges } from './subscribeToCrdtChanges';
