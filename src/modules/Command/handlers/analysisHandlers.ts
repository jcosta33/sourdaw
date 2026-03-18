import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import { analyzeMix } from '#/modules/AiRuntime/useCases/analyzeMix';
import { getMixAnalysisStoreValue, setMixAnalysisStoreValue } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { executeAppAction } from '../useCases/executeAppAction';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const analysisHandlers = {
    analyzeMix: {
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
    } satisfies ActionHandler<Extract<AppAction, 'analyzeMix'>>,

    autoFixMix: {
        execute: async () => {
            const state = getMixAnalysisStoreValue();
            if (!state) {
                return;
            }

            setMixAnalysisStoreValue({ ...state, isAnalyzing: true });

            try {
                const result = await analyzeMix();
                setMixAnalysisStoreValue({ result, isAnalyzing: false, panelOpen: true });

                for (const tl of result.trackLevels) {
                    if (tl.isClipping) {
                        const overshootDb = tl.peakDb + 0.5;
                        const currentLinear = 10 ** (tl.peakDb / 20);
                        const targetLinear = currentLinear / 10 ** ((overshootDb + 3) / 20);
                        const newGain = Math.max(0, Math.min(1, targetLinear));
                        await executeAppAction({
                            type: 'setTrackGain',
                            payload: { trackId: tl.trackId, gain: newGain },
                        });
                    }
                }

                if (result.overallLevel.peakDb > -3) {
                    const reductionDb = result.overallLevel.peakDb + 6;
                    const currentMasterLinear = 10 ** (result.overallLevel.peakDb / 20);
                    const targetMasterLinear = currentMasterLinear / 10 ** (reductionDb / 20);
                    const newMasterGain = Math.max(0, Math.min(1, targetMasterLinear));
                    await executeAppAction({ type: 'setMasterGain', payload: { gain: newMasterGain } });
                }

                const refreshed = await analyzeMix();
                setMixAnalysisStoreValue({ result: refreshed, isAnalyzing: false, panelOpen: true });
            } catch {
                setMixAnalysisStoreValue({ ...state, isAnalyzing: false });
            }
        },
        describe: () => ({ label: 'Auto-fix mix issues' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'autoFixMix'>>,
};
