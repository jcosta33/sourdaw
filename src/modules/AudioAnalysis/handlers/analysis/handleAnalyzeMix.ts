import { createHandler } from '#/helpers/createHandler';
import { getMixAnalysisStoreValue, setMixAnalysisStoreValue } from '#/modules/AiRuntime/useCases';
import { analyzeMix } from '../../useCases/analyzeMix';

export const handleAnalyzeMix = createHandler<'analyzeMix'>({
    execute: async () => {
        const state = getMixAnalysisStoreValue();
        if (!state) {
            return;
        }

        setMixAnalysisStoreValue({ ...state, isAnalyzing: true });

        try {
            const result = await analyzeMix();
            setMixAnalysisStoreValue({ result, isAnalyzing: false, panelOpen: true });
        } catch {
            setMixAnalysisStoreValue({ ...state, isAnalyzing: false });
        }
    },
    describe: () => ({ label: 'Analyze mix' }),
    undoable: false,
});
