export { addAutomationLane } from './automation/addAutomationLane';
export { addAutomationPoint } from './automation/addAutomationPoint';
export { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';
export { createAutomationLane } from './automation/createAutomationLane';
export { duplicateClipAutomation } from './automation/duplicateClipAutomation';
export { getAutomationValueAtBeat } from './automation/getAutomationValueAtBeat';
export { removeAutomationLane } from './automation/removeAutomationLane';
export { removeAutomationPoint } from './automation/removeAutomationPoint';
export { setAutomationPointCurve } from './automation/setAutomationPointCurve';
export { shiftClipAutomation } from './automation/shiftClipAutomation';
export { toggleAutomationVisibility } from './automation/toggleAutomationVisibility';
export { toggleLaneCollapsed } from './automation/toggleLaneCollapsed';
export { updateAutomationPoint } from './automation/updateAutomationPoint';
export { updateAutomationObjectPoint } from './automation/updateAutomationObjectPoint';
export { resetOverride } from './automation/resetOverride';
export {
    beginDrawSession,
    paintDrawPoint,
    endDrawSession,
    isDrawSessionActive,
} from './automationDrawMode';
export { getAutomationHandlers } from './getAutomationHandlers';
export { isRecordingAutomation } from './automationRecording/isRecordingAutomation';
export { recordAutomationValue } from './automationRecording/recordAutomationValue';
export { releaseTouchAutomation } from './automationRecording/releaseTouchAutomation';
export { startAutomationRecording } from './automationRecording/startAutomationRecording';
export { stopAutomationRecording } from './automationRecording/stopAutomationRecording';
export { selectPointsInRange } from './automationSelection/selectPointsInRange';
export { transformSelectedPoints } from './automationSelection/transformSelectedPoints';
export { deleteSelectedPoints } from './automationSelection/deleteSelectedPoints';
export { getSelectionBounds } from './automationSelection/getSelectionBounds';
export { insertAutomationShape } from './automationShapes';
export { zoomToUsedRange } from './automationZoom/zoomToUsedRange';
export { resetYZoom } from './automationZoom/resetYZoom';
export { adjustYZoom } from './automationZoom/adjustYZoom';
export { toggleVirginTerritory } from './automationZoom/toggleVirginTerritory';
export { applyModulation } from './modulation/applyModulation';
export { getModulationForParam } from './modulation/getModulationForParam';
export { getAutomationLanes } from './getAutomationLanes';
export { getAutomationStoreState } from './getAutomationStoreState';
