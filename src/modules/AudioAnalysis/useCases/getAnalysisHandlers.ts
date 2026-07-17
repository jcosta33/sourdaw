import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { handleAnalyzeMix } from '../handlers/analysis/handleAnalyzeMix';
import { handleAudioToMidi } from '../handlers/analysis/handleAudioToMidi';
import { handleAutoFixMix } from '../handlers/analysis/handleAutoFixMix';
import { handleCompareToReference } from '../handlers/analysis/handleCompareToReference';
import { handleDetectKey } from '../handlers/analysis/handleDetectKey';
import { handleDetectTempo } from '../handlers/analysis/handleDetectTempo';

type AnalysisAppAction =
    | Extract<AppAction, { type: 'analyzeMix' }>
    | Extract<AppAction, { type: 'autoFixMix' }>
    | Extract<AppAction, { type: 'audioToMidi' }>
    | Extract<AppAction, { type: 'compareToReference' }>
    | Extract<AppAction, { type: 'detectKey' }>
    | Extract<AppAction, { type: 'detectTempo' }>;

export type AnalysisHandlersMap = {
    [Action in AnalysisAppAction as Action['type']]: ActionHandler<Action>;
};

/**
 * Merges mix-analysis `ActionHandler` maps for Command. Does **not** call `createHandler` here.
 */
export function getAnalysisHandlers(): AnalysisHandlersMap {
    return {
        analyzeMix: handleAnalyzeMix,
        autoFixMix: handleAutoFixMix,
        audioToMidi: handleAudioToMidi,
        compareToReference: handleCompareToReference,
        detectKey: handleDetectKey,
        detectTempo: handleDetectTempo,
    };
}
