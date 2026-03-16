import type { ActionHandler } from "../models/ActionHandler";
import type { AppAction } from "../models/AppAction";
import { analyzeMix } from "#/modules/AiRuntime/useCases/analyzeMix";
import { mixAnalysisStore } from "#/modules/AiRuntime/stores/mixAnalysisStore";
import { executeAppAction } from "../useCases/executeAppAction";

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const analysisHandlers = {
    analyzeMix: {
        execute: async () => {
            const state = mixAnalysisStore.value;
            if (!state) {
                return;
            }

            mixAnalysisStore.set({ ...state, isAnalyzing: true });

            try {
                const result = await analyzeMix();
                mixAnalysisStore.set({ result, isAnalyzing: false, panelOpen: true });
            } catch {
                mixAnalysisStore.set({ ...state, isAnalyzing: false });
            }
        },
        describe: () => ({ label: "Analyze mix" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "analyzeMix">>,

    autoFixMix: {
        execute: async () => {
            const state = mixAnalysisStore.value;
            if (!state) {
                return;
            }

            mixAnalysisStore.set({ ...state, isAnalyzing: true });

            try {
                const result = await analyzeMix();
                mixAnalysisStore.set({ result, isAnalyzing: false, panelOpen: true });

                for (const tl of result.trackLevels) {
                    if (tl.isClipping) {
                        const overshootDb = tl.peakDb + 0.5;
                        const currentLinear = Math.pow(10, tl.peakDb / 20);
                        const targetLinear = currentLinear / Math.pow(10, (overshootDb + 3) / 20);
                        const newGain = Math.max(0, Math.min(1, targetLinear));
                        await executeAppAction({ type: "setTrackGain", payload: { trackId: tl.trackId, gain: newGain } });
                    }
                }

                if (result.overallLevel.peakDb > -3) {
                    const reductionDb = result.overallLevel.peakDb + 6;
                    const currentMasterLinear = Math.pow(10, result.overallLevel.peakDb / 20);
                    const targetMasterLinear = currentMasterLinear / Math.pow(10, reductionDb / 20);
                    const newMasterGain = Math.max(0, Math.min(1, targetMasterLinear));
                    await executeAppAction({ type: "setMasterGain", payload: { gain: newMasterGain } });
                }

                const refreshed = await analyzeMix();
                mixAnalysisStore.set({ result: refreshed, isAnalyzing: false, panelOpen: true });
            } catch {
                mixAnalysisStore.set({ ...state, isAnalyzing: false });
            }
        },
        describe: () => ({ label: "Auto-fix mix issues" }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, "autoFixMix">>,
};
