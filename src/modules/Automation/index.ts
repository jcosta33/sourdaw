// stores/automationStore
export { automationStore } from './stores/automationStore';
export { modulationStore, modulationRuntimeStore } from './stores/modulationStore';
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

// useCases/getAutomationHandlers.ts
export { getAutomationHandlers } from './useCases/getAutomationHandlers';

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

export { selectPointsInRange } from './useCases/automationSelection/selectPointsInRange';
export { transformSelectedPoints } from './useCases/automationSelection/transformSelectedPoints';
export { deleteSelectedPoints } from './useCases/automationSelection/deleteSelectedPoints';
export { getSelectionBounds } from './useCases/automationSelection/getSelectionBounds';

// useCases/automationShapes
export { insertAutomationShape } from './useCases/automationShapes';

export { zoomToUsedRange } from './useCases/automationZoom/zoomToUsedRange';
export { resetYZoom } from './useCases/automationZoom/resetYZoom';
export { adjustYZoom } from './useCases/automationZoom/adjustYZoom';
export { toggleVirginTerritory } from './useCases/automationZoom/toggleVirginTerritory';
export { applyModulation } from './useCases/modulation/applyModulation';
export { getModulationForParam } from './useCases/modulation/getModulationForParam';

// useCases/getAutomationLanes
export { getAutomationLanes } from './useCases/getAutomationLanes';

// useCases/getAutomationStoreState
export { getAutomationStoreState } from './useCases/getAutomationStoreState';
