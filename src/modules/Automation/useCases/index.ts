// Automation/useCases — public contract surface for cross-module automation access.
export { addAutomationLane } from './automation/addAutomationLane';
export { addAutomationPoint } from './automation/addAutomationPoint';
export { batchAddAutomationPoints } from './automation/batchAddAutomationPoints';
export { createAutomationLane } from './automation/createAutomationLane';
export { duplicateClipAutomation } from './automation/duplicateClipAutomation';
export { recordAutomationValue } from './automationRecording/recordAutomationValue';
export { removeAutomationLane } from './automation/removeAutomationLane';
export { removeAutomationPoint } from './automation/removeAutomationPoint';
export { shiftClipAutomation } from './automation/shiftClipAutomation';
export { updateAutomationPoint } from './automation/updateAutomationPoint';
export { setAutomationPointCurve } from './automation/setAutomationPointCurve';
export { toggleAutomationVisibility } from './automation/toggleAutomationVisibility';
export { toggleLaneCollapsed } from './automation/toggleLaneCollapsed';

export { startAutomationRecording } from './automationRecording/startAutomationRecording';
export { stopAutomationRecording } from './automationRecording/stopAutomationRecording';
export { releaseTouchAutomation } from './automationRecording/releaseTouchAutomation';

export { beginDrawSession, paintDrawPoint, endDrawSession } from './automationDrawMode';
export { selectPointsInRange } from './automationSelection/selectPointsInRange';

export { applyModulation } from './modulation/applyModulation';
export { applyModulationToEngine } from './modulation/applyModulationToEngine';
export { getModulationForParam } from './modulation/getModulationForParam';
export { addModulator } from './modulation/addModulator';
export { removeModulator } from './modulation/removeModulator';
export { updateModulator } from './modulation/updateModulator';
export { addMapping } from './modulation/addMapping';
export { removeMapping } from './modulation/removeMapping';
export { updateMapping } from './modulation/updateMapping';

export { getAutomationLanes } from './getAutomationLanes';
export { getAutomationStoreState } from './getAutomationStoreState';
export { getAutomationHandlers } from './getAutomationHandlers';

export { insertAutomationShape } from './automationShapes';
export { deleteSelectedPoints } from './automationSelection/deleteSelectedPoints';
export { getSelectionBounds } from './automationSelection/getSelectionBounds';
export { adjustYZoom } from './automationZoom/adjustYZoom';
export { zoomToUsedRange } from './automationZoom/zoomToUsedRange';
export { toggleVirginTerritory } from './automationZoom/toggleVirginTerritory';

// Helper for playheadScheduler
export { getAutomationValueAtBeat } from './automation/getAutomationValueAtBeat';
export { isRecordingAutomation } from './automationRecording/isRecordingAutomation';
