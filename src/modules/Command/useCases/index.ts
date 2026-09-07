// Command/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { describeAction } from './actionLabels';
export { setActionHistoryMetadataPort } from './actionHistoryMetadataPort';
export { CommandEventBus, setCommandEventBus } from './commandEventBus';
export { commandProjectRevisionPort } from './commandProjectRevisionPort';
export { commandProjectDivergencePort } from './commandProjectDivergencePort';
export { commandBatchPreflightPort } from './commandBatchPreflightPort';
export { commandBatchPreviewPort } from './commandBatchPreviewPort';
export { commandRuntimeRepairPort } from './commandRuntimeRepairPort';
export { configureCommandBatchIdempotency } from './configureCommandBatchIdempotency';
export { resetCommandBatchIdempotency } from './resetCommandBatchIdempotency';
export { canExecuteCommandBatchEffects } from './canExecuteCommandBatchEffects';
export { buildSemanticProjectDiff } from './buildSemanticProjectDiff';
export { compilePartialCommandBatchAcceptance } from './compilePartialCommandBatchAcceptance';
export { commandDeviceVersionsPort } from './commandDeviceVersionsPort';
export { commandTrackDefaultsPort } from './commandTrackDefaultsPort';
export { captureCommandTargetFingerprints } from './captureCommandTargetFingerprints';
export { getVersionedCommandBatchDivergenceTargetIds } from './getVersionedCommandBatchDivergenceTargetIds';
export { refreshVersionedCommandBatchForApproval } from './refreshVersionedCommandBatchForApproval';
export { getCommandDivergenceTargetIds } from './getCommandDivergenceTargetIds';
export { createCallbackUndoEntry } from './createCallbackUndoEntry';
export { createVersionedCommandEnvelope } from './createVersionedCommandEnvelope';
export { compileVersionedCommandBatchEnvelope } from './compileVersionedCommandBatchEnvelope';
export { issueCommandApprovalBinding } from './issueCommandApprovalBinding';
export { createVersionedCommandReceipt } from './createVersionedCommandReceipt';
export { createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
export { getVerifiedBatchReceiptIdentity } from './getVerifiedBatchReceiptIdentity';
export { getAppActionExecutionPolicy } from './getAppActionExecutionPolicy';
export { getAppActionStaticAuthority } from './getAppActionStaticAuthority';
export { getAgentActionRiskPolicy } from './getAgentActionRiskPolicy';
export { getExecutableAppActionIntentCatalog } from './getExecutableAppActionIntentCatalog';
export {
    MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH,
    getExecutableAppActionIntentCatalogUnicodeLength,
} from './getExecutableAppActionIntentCatalogUnicodeLength';
export { getExecutableAppActionToolSchemas } from './getExecutableAppActionToolSchemas';
export { getMidiTransformToolSchemas } from './getMidiTransformToolSchemas';
export { getMidiTransformContract } from './getMidiTransformContract';
export { expandMidiTransform } from './expandMidiTransform';
export { getExecutableAppActionProviderSchema } from './getExecutableAppActionProviderSchema';
export { getExecutableAppActionGroundingCatalog } from './getExecutableAppActionGroundingCatalog';
export { getExecutableAppActionGroundingRules } from './getExecutableAppActionGroundingRules';
export { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';
export { isExecutableAppActionType } from './executableAppActionRegistry';
export { registerProductionCommandHandlers } from './registerProductionCommandHandlers';
export { getVersionedCommandSemanticFingerprint } from './getVersionedCommandSemanticFingerprint';
export { getVersionedCommandArgumentsDigest } from './getVersionedCommandArgumentsDigest';
export { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';
export { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
export { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
export { migrateLegacyAppActionToVersionedCommandEnvelope } from './migrateLegacyAppActionToVersionedCommandEnvelope';
export { requiresAppActionConfirmation } from './requiresAppActionConfirmation';
export { selectExecutableAppActionToolSchemasForPrompt } from './selectExecutableAppActionToolSchemasForPrompt';
export { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';
export { serializeVersionedCommandBatchEnvelope } from './serializeVersionedCommandBatchEnvelope';
export { createUndoEntry } from './createUndoEntry';

export { generateGroupId } from './generateGroupId';

export { executeAppAction } from './executeAppAction';
export { executeUserAppAction } from './executeUserAppAction';
export { executeAppActionBatch } from './executeAppActionBatch';
export { executeVersionedCommandEnvelope } from './executeVersionedCommandEnvelope';
export { executeVersionedCommandBatch } from './executeVersionedCommandBatch';
export { executeVersionedCommandBatchEnvelope } from './executeVersionedCommandBatchEnvelope';
export { getVersionedCommandBatchIdempotentReplay } from './getVersionedCommandBatchIdempotentReplay';
export { finalizeRecoveredCommandBatchEffects } from './finalizeRecoveredCommandBatchEffects';
export { getVersionedCommandBatchCommitProof } from './getVersionedCommandBatchCommitProof';
export { getVersionedCommandBatchCommitDisposition } from './getVersionedCommandBatchCommitDisposition';
export { getVersionedCommandBatchEffects } from './getVersionedCommandBatchEffects';
export { getVersionedCommandTargetRanges } from './getVersionedCommandTargetRanges';
export { getCommandProtocolContracts } from './getCommandProtocolContracts';
export { productionBriefAdmissionPort } from './productionBriefAdmissionPort';
export { createAppActionCommittedError } from './createAppActionCommittedError';
export { isAppActionCommittedError } from './isAppActionCommittedError';

export { getMacroHandlers } from './getMacroHandlers';
export { getUndoRedoHandlers } from './getUndoRedoHandlers';
export { getUndoTreeHandlers } from './getUndoTreeHandlers';

// `playMacro` / `deleteMacro` / `renameMacro` are invoked through
// `executeAppAction` (each has an AppAction + a handler registered in
// `getMacroHandlers`), so their use-case re-exports would be redundant
// cross-module entry points that bypass dispatch — not re-exported.

export { startMacroRecording } from './macro/recording/startMacroRecording';
export { stopMacroRecording } from './macro/recording/stopMacroRecording';

export { undo } from './undo';
export { redo } from './redo';
export { REDO_NOT_APPLIED } from './redoResult';
export { revertActionGroup } from './revertActionGroup';
export { getActionReplayStatus } from './getActionReplayStatus';
export { revertAction } from './revertAction';
export { clearActionHistory } from './clearActionHistory';
export { resetActionReplayAuthority } from './resetActionReplayAuthority';
export { syncActionReplayMetadata } from './syncActionReplayMetadata';
export { clearUndoHistory } from './clearUndoHistory';
export { reconcileSessionUndoForProject } from './reconcileSessionUndoForProject';
export { stampSessionUndoWitness } from './stampSessionUndoWitness';
export { captureUndoHistory } from './captureUndoHistory';
export { restoreUndoHistory } from './restoreUndoHistory';
export { pushUndoEntry } from './pushUndoEntry';
export { commitActionUndoEntry } from './commitActionUndoEntry';
export { commitUndoEntry } from './commitUndoEntry';
// Pitch-edit dispatch (`getPitchHandlers`) and dependency injection
// (`setPitchEditDependencies`) now live in Knead/useCases — Knead owns the
// pitch aggregate. See ADR 0011 Wave 3.
// Command palette + keyboard-shortcut orchestration (`setShortcutMapping`,
// `resetShortcutMappings`, the command registry, selection helpers and the
// shortcut store) now live in CommandInterface/* — that module owns the
// palette/shortcut interface and depends on this dispatch kernel. See ADR
// 0011 Wave 3.
