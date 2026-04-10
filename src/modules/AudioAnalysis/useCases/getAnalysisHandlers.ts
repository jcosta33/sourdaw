import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { handleAnalyzeMix } from '../handlers/analysis/handleAnalyzeMix';
import { handleAutoFixMix } from '../handlers/analysis/handleAutoFixMix';

type AnalysisAppAction =
    | Extract<AppAction, { type: 'analyzeMix' }>
    | Extract<AppAction, { type: 'autoFixMix' }>;

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
    };
}
