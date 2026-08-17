// Automation/useCases — public contract surface for cross-module automation access.
export { addAutomationLane } from './automation/addAutomationLane';
export { getSendAutomationBusId } from './automation/getSendAutomationBusId';
export { addAutomationPoint } from './automation/addAutomationPoint';
export { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';
export { createAutomationLane } from './automation/createAutomationLane';
export { setAutomationParameterRangeResolver } from './automation/automationParameterRangeDependencies';
export { clipAutomationMoveStateMatches } from './automation/clipAutomationMoveStateMatches';
export { duplicateClipAutomation } from './automation/duplicateClipAutomation';
export { duplicateClipAutomationBatch } from './automation/duplicateClipAutomationBatch';
export { getClipAutomationMoveState } from './automation/getClipAutomationMoveState';
export { deleteAutomationTimeRange } from './automation/deleteAutomationTimeRange';
export { recordAutomationValue } from './automationRecording/recordAutomationValue';
export { captureAutomationRecordingRollback } from './automationRecording/captureAutomationRecordingRollback';
export { setAutomationRecordingDependencies } from './automationRecording/recordingDependencies';
export { setModulationDependencies } from './modulation/modulationDependencies';
export { removeAutomationLane } from './automation/removeAutomationLane';
export { removeAutomationLanesForTrack } from './automation/removeAutomationLanesForTrack';
export { removeAutomationPoint } from './automation/removeAutomationPoint';
export { prepareAutomationTimeOperation } from './automation/prepareAutomationTimeOperation';
export { prepareAutomationTimeStateRestore } from './automation/prepareAutomationTimeStateRestore';
export { prepareClipAutomationShiftTransaction } from './automation/prepareClipAutomationShiftTransaction';
export { replaceAutomationLanePoints } from './automation/replaceAutomationLanePoints';
export { restoreAutomationLanes } from './automation/restoreAutomationLanes';
export { restoreClipAutomationMoveState } from './automation/restoreClipAutomationMoveState';
export { restoreAutomationSnapshot } from './restoreAutomationSnapshot';
export { shiftAutomationAfterBeat } from './automation/shiftAutomationAfterBeat';
export { shiftClipAutomation } from './automation/shiftClipAutomation';
export { updateAutomationPoint } from './automation/updateAutomationPoint';
export { setAutomationPointCurve } from './automation/setAutomationPointCurve';
export { simplifyGesturePoints } from './automation/simplifyGesturePoints';
export { toggleAutomationVisibility } from './automation/toggleAutomationVisibility';
export { toggleLaneCollapsed } from './automation/toggleLaneCollapsed';

export { startAutomationRecording } from './automationRecording/startAutomationRecording';
export { stopAutomationRecording } from './automationRecording/stopAutomationRecording';
export { releaseTouchAutomation } from './automationRecording/releaseTouchAutomation';
export { resolveAutoMatchValue } from './automationRecording/resolveAutoMatchValue';

export { beginDrawSession } from './beginDrawSession';
export { paintDrawPoint } from './paintDrawPoint';
export { endDrawSession } from './endDrawSession';
export { cancelDrawSession } from './cancelDrawSession';
export { selectPointsInRange } from './automationSelection/selectPointsInRange';

export { applyModulation } from './modulation/applyModulation';
export { applyModulationToEngine } from './modulation/applyModulationToEngine';
export { addModulator } from './modulation/addModulator';
export { removeModulator } from './modulation/removeModulator';
export { updateModulator } from './modulation/updateModulator';
export { addMapping } from './modulation/addMapping';
export { hydrateModulationState } from './modulation/hydrateModulationState';
export { removeMapping } from './modulation/removeMapping';
export { restoreTrackModulationReferences } from './modulation/restoreTrackModulationReferences';
export { updateMapping } from './modulation/updateMapping';

export { getAutomationLanes } from './getAutomationLanes';
export { getAutomationStoreState } from './getAutomationStoreState';
export { getAutomationHandlers } from './getAutomationHandlers';

export { insertAutomationShape } from './automationShapes';
export { deleteSelectedPoints } from './automationSelection/deleteSelectedPoints';
export { getSelectionBounds } from './automationSelection/getSelectionBounds';
export { adjustYZoom } from './automationZoom/adjustYZoom';
export { zoomToUsedRange } from './automationZoom/zoomToUsedRange';

// Helper for playheadScheduler
export { getAutomationValueAtBeat } from './automation/getAutomationValueAtBeat';
export { isRecordingAutomation } from './automationRecording/isRecordingAutomation';
