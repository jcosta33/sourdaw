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
export {
    selectPointsInRange,
    transformSelectedPoints,
    deleteSelectedPoints,
    getSelectionBounds,
} from './automationSelection';
export { insertAutomationShape } from './automationShapes';
export { zoomToUsedRange, resetYZoom, adjustYZoom, toggleVirginTerritory } from './automationZoom';
export { getAutomationLanes } from './getAutomationLanes';
export { getAutomationStoreState } from './getAutomationStoreState';
