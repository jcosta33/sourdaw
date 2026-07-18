import { handleAddCvOutput } from '../handlers/finalFeature/handleAddCvOutput';
import { handleCloseElasticEditor } from '../handlers/finalFeature/handleCloseElasticEditor';
import { handleDetectTransients } from '../handlers/finalFeature/handleDetectTransients';
import { handleElasticAddMarker } from '../handlers/finalFeature/handleElasticAddMarker';
import { handleElasticRemoveMarker } from '../handlers/finalFeature/handleElasticRemoveMarker';
import { handleElasticSetSensitivity } from '../handlers/finalFeature/handleElasticSetSensitivity';
import { handleElasticSetTool } from '../handlers/finalFeature/handleElasticSetTool';
import { handleElasticToggleMarkerLock } from '../handlers/finalFeature/handleElasticToggleMarkerLock';
import { handleEnableWarping } from '../handlers/finalFeature/handleEnableWarping';
import { handleGetLatencyReport } from '../handlers/finalFeature/handleGetLatencyReport';
import { handleOpenElasticEditor } from '../handlers/finalFeature/handleOpenElasticEditor';
import { handleQuantizeTransients } from '../handlers/finalFeature/handleQuantizeTransients';
import { handleSetMasterGain } from '../handlers/finalFeature/handleSetMasterGain';
import { handleSetWarpAlgorithm } from '../handlers/finalFeature/handleSetWarpAlgorithm';
import { handleSetWarpPitchShift } from '../handlers/finalFeature/handleSetWarpPitchShift';
import { handleToggleNodeView } from '../handlers/finalFeature/handleToggleNodeView';

export type FinalFeatureHandlersMap = {
    addCvOutput: typeof handleAddCvOutput;
    closeElasticEditor: typeof handleCloseElasticEditor;
    detectTransients: typeof handleDetectTransients;
    elasticAddMarker: typeof handleElasticAddMarker;
    elasticRemoveMarker: typeof handleElasticRemoveMarker;
    elasticSetSensitivity: typeof handleElasticSetSensitivity;
    elasticSetTool: typeof handleElasticSetTool;
    elasticToggleMarkerLock: typeof handleElasticToggleMarkerLock;
    enableWarping: typeof handleEnableWarping;
    getLatencyReport: typeof handleGetLatencyReport;
    openElasticEditor: typeof handleOpenElasticEditor;
    quantizeTransients: typeof handleQuantizeTransients;
    setMasterGain: typeof handleSetMasterGain;
    setWarpAlgorithm: typeof handleSetWarpAlgorithm;
    setWarpPitchShift: typeof handleSetWarpPitchShift;
    toggleNodeView: typeof handleToggleNodeView;
};

/**
 * Merges AudioEngine final-feature `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getFinalFeatureHandlers(): FinalFeatureHandlersMap {
    return {
        detectTransients: handleDetectTransients,
        quantizeTransients: handleQuantizeTransients,
        openElasticEditor: handleOpenElasticEditor,
        closeElasticEditor: handleCloseElasticEditor,
        elasticSetSensitivity: handleElasticSetSensitivity,
        elasticAddMarker: handleElasticAddMarker,
        elasticRemoveMarker: handleElasticRemoveMarker,
        elasticToggleMarkerLock: handleElasticToggleMarkerLock,
        elasticSetTool: handleElasticSetTool,
        toggleNodeView: handleToggleNodeView,
        addCvOutput: handleAddCvOutput,
        enableWarping: handleEnableWarping,
        setWarpAlgorithm: handleSetWarpAlgorithm,
        setWarpPitchShift: handleSetWarpPitchShift,
        getLatencyReport: handleGetLatencyReport,
        setMasterGain: handleSetMasterGain,
    };
}
