// stores/automationStore
export { automationStore } from './stores/automationStore';
export type { AutomationStoreState } from './stores/automationStore';

// useCases/automation/addAutomationLane
export { addAutomationLane } from './useCases/automation/addAutomationLane';

// useCases/automation/addAutomationPoint
export { addAutomationPoint } from './useCases/automation/addAutomationPoint';

// useCases/automation/batchAddAutomationPoints
export { batchAddAutomationPoints } from './useCases/automation/batchAddAutomationPoints';

// useCases/automation/createAutomationLane
export { createAutomationLane } from './useCases/automation/createAutomationLane';

// useCases/automation/duplicateClipAutomation
export { duplicateClipAutomation } from './useCases/automation/duplicateClipAutomation';

// useCases/automation/getAutomationValueAtBeat
export { getAutomationValueAtBeat } from './useCases/automation/getAutomationValueAtBeat';

// useCases/automation/removeAutomationLane
export { removeAutomationLane } from './useCases/automation/removeAutomationLane';

// useCases/automation/removeAutomationPoint
export { removeAutomationPoint } from './useCases/automation/removeAutomationPoint';

// useCases/automation/setAutomationPointCurve
export { setAutomationPointCurve } from './useCases/automation/setAutomationPointCurve';

// useCases/automation/shiftClipAutomation
export { shiftClipAutomation } from './useCases/automation/shiftClipAutomation';

// useCases/automation/toggleAutomationVisibility
export { toggleAutomationVisibility } from './useCases/automation/toggleAutomationVisibility';

// useCases/automation/toggleLaneCollapsed
export { toggleLaneCollapsed } from './useCases/automation/toggleLaneCollapsed';

// useCases/automation/updateAutomationPoint
export { updateAutomationPoint } from './useCases/automation/updateAutomationPoint';

// useCases/automationDrawMode
export {
    beginDrawSession,
    paintDrawPoint,
    endDrawSession,
    isDrawSessionActive,
} from './useCases/automationDrawMode';

// useCases/automationHandlers
export { automationHandlers } from './useCases/automationHandlers';

// useCases/automationRecording/isRecordingAutomation
export { isRecordingAutomation } from './useCases/automationRecording/isRecordingAutomation';

// useCases/automationRecording/recordAutomationValue
export { recordAutomationValue } from './useCases/automationRecording/recordAutomationValue';

// useCases/automationRecording/releaseTouchAutomation
export { releaseTouchAutomation } from './useCases/automationRecording/releaseTouchAutomation';

// useCases/automationRecording/startAutomationRecording
export { startAutomationRecording } from './useCases/automationRecording/startAutomationRecording';

// useCases/automationRecording/stopAutomationRecording
export { stopAutomationRecording } from './useCases/automationRecording/stopAutomationRecording';

// useCases/automationSelection
export {
    selectPointsInRange,
    transformSelectedPoints,
    deleteSelectedPoints,
    getSelectionBounds,
} from './useCases/automationSelection';

// useCases/automationShapes
export { insertAutomationShape } from './useCases/automationShapes';
export type { AutomationShapeType } from './useCases/automationShapes';

// useCases/automationZoom
export { zoomToUsedRange, resetYZoom, adjustYZoom, toggleVirginTerritory } from './useCases/automationZoom';

// useCases/getAutomationLanes
export { getAutomationLanes } from './useCases/getAutomationLanes';

// useCases/getAutomationStoreState
export { getAutomationStoreState } from './useCases/getAutomationStoreState';
