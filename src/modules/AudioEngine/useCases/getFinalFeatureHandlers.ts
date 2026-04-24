import { handleAddCvOutput } from '../handlers/finalFeature/handleAddCvOutput';
import { handleConnectPush } from '../handlers/finalFeature/handleConnectPush';
import { handleDetectTransients } from '../handlers/finalFeature/handleDetectTransients';
import { handleDisableMpe } from '../handlers/finalFeature/handleDisableMpe';
import { handleDisconnectPush } from '../handlers/finalFeature/handleDisconnectPush';
import { handleEnableMpe } from '../handlers/finalFeature/handleEnableMpe';
import { handleEnableWarping } from '../handlers/finalFeature/handleEnableWarping';
import { handleExportDawProject } from '../handlers/finalFeature/handleExportDawProject';
import { handleGetLatencyReport } from '../handlers/finalFeature/handleGetLatencyReport';
import { handleLoadRaveModel } from '../handlers/finalFeature/handleLoadRaveModel';
import { handleQuantizeTransients } from '../handlers/finalFeature/handleQuantizeTransients';
import { handleSetControlSurface } from '../handlers/finalFeature/handleSetControlSurface';
import { handleSetMasterGain } from '../handlers/finalFeature/handleSetMasterGain';
import { handleSetRaveBlend } from '../handlers/finalFeature/handleSetRaveBlend';
import { handleSetWarpAlgorithm } from '../handlers/finalFeature/handleSetWarpAlgorithm';
import { handleSetWarpPitchShift } from '../handlers/finalFeature/handleSetWarpPitchShift';
import { handleSwitchMonitor } from '../handlers/finalFeature/handleSwitchMonitor';
import { handleToggleControlRoomDim } from '../handlers/finalFeature/handleToggleControlRoomDim';
import { handleToggleControlRoomMono } from '../handlers/finalFeature/handleToggleControlRoomMono';
import { handleToggleNodeView } from '../handlers/finalFeature/handleToggleNodeView';

export type FinalFeatureHandlersMap = {
    addCvOutput: typeof handleAddCvOutput;
    connectPush: typeof handleConnectPush;
    detectTransients: typeof handleDetectTransients;
    disableMpe: typeof handleDisableMpe;
    disconnectPush: typeof handleDisconnectPush;
    enableMpe: typeof handleEnableMpe;
    enableWarping: typeof handleEnableWarping;
    exportDawProject: typeof handleExportDawProject;
    getLatencyReport: typeof handleGetLatencyReport;
    loadRaveModel: typeof handleLoadRaveModel;
    quantizeTransients: typeof handleQuantizeTransients;
    setControlSurface: typeof handleSetControlSurface;
    setMasterGain: typeof handleSetMasterGain;
    setRaveBlend: typeof handleSetRaveBlend;
    setWarpAlgorithm: typeof handleSetWarpAlgorithm;
    setWarpPitchShift: typeof handleSetWarpPitchShift;
    switchMonitor: typeof handleSwitchMonitor;
    toggleControlRoomDim: typeof handleToggleControlRoomDim;
    toggleControlRoomMono: typeof handleToggleControlRoomMono;
    toggleNodeView: typeof handleToggleNodeView;
};

/**
 * Merges AudioEngine final-feature `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getFinalFeatureHandlers(): FinalFeatureHandlersMap {
    return {
        detectTransients: handleDetectTransients,
        quantizeTransients: handleQuantizeTransients,
        toggleNodeView: handleToggleNodeView,
        setControlSurface: handleSetControlSurface,
        addCvOutput: handleAddCvOutput,
        connectPush: handleConnectPush,
        disconnectPush: handleDisconnectPush,
        exportDawProject: handleExportDawProject,
        loadRaveModel: handleLoadRaveModel,
        setRaveBlend: handleSetRaveBlend,
        enableWarping: handleEnableWarping,
        setWarpAlgorithm: handleSetWarpAlgorithm,
        setWarpPitchShift: handleSetWarpPitchShift,
        switchMonitor: handleSwitchMonitor,
        toggleControlRoomDim: handleToggleControlRoomDim,
        toggleControlRoomMono: handleToggleControlRoomMono,
        enableMpe: handleEnableMpe,
        disableMpe: handleDisableMpe,
        getLatencyReport: handleGetLatencyReport,
        setMasterGain: handleSetMasterGain,
    };
}
