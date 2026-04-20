import { type ActionHandler, type AppAction } from '#/modules/Command/useCases';

import { handleAddCvOutput } from '../handlers/finalFeature/handleAddCvOutput';
import { handleConnectPush } from '../handlers/finalFeature/handleConnectPush';
import { handleDetectTransients } from '../handlers/finalFeature/handleDetectTransients';
import { handleDisconnectPush } from '../handlers/finalFeature/handleDisconnectPush';
import { handleEnableWarping } from '../handlers/finalFeature/handleEnableWarping';
import { handleExportDawProject } from '../handlers/finalFeature/handleExportDawProject';
import { handleLoadRaveModel } from '../handlers/finalFeature/handleLoadRaveModel';
import { handleQuantizeTransients } from '../handlers/finalFeature/handleQuantizeTransients';
import { handleSetControlSurface } from '../handlers/finalFeature/handleSetControlSurface';
import { handleSetRaveBlend } from '../handlers/finalFeature/handleSetRaveBlend';
import { handleSetWarpAlgorithm } from '../handlers/finalFeature/handleSetWarpAlgorithm';
import { handleSetWarpPitchShift } from '../handlers/finalFeature/handleSetWarpPitchShift';
import { handleToggleNodeView } from '../handlers/finalFeature/handleToggleNodeView';

type FinalFeatureAppAction =
    | Extract<AppAction, { type: 'detectTransients' }>
    | Extract<AppAction, { type: 'quantizeTransients' }>
    | Extract<AppAction, { type: 'toggleNodeView' }>
    | Extract<AppAction, { type: 'setControlSurface' }>
    | Extract<AppAction, { type: 'addCvOutput' }>
    | Extract<AppAction, { type: 'connectPush' }>
    | Extract<AppAction, { type: 'disconnectPush' }>
    | Extract<AppAction, { type: 'exportDawProject' }>
    | Extract<AppAction, { type: 'loadRaveModel' }>
    | Extract<AppAction, { type: 'setRaveBlend' }>
    | Extract<AppAction, { type: 'enableWarping' }>
    | Extract<AppAction, { type: 'setWarpAlgorithm' }>
    | Extract<AppAction, { type: 'setWarpPitchShift' }>;

export type FinalFeatureHandlersMap = {
    [Action in FinalFeatureAppAction as Action['type']]: ActionHandler<Action>;
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
    };
}
