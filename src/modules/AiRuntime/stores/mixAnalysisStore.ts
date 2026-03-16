import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { MixAnalysisResult } from "../useCases/analyzeMix";

const logger = Container.getInstance().get(Logger);

export type MixAnalysisStoreState = {
    result: MixAnalysisResult | null;
    isAnalyzing: boolean;
    panelOpen: boolean;
};

export const mixAnalysisStore = new Store<MixAnalysisStoreState>(logger, {
    initialData: {
        result: null,
        isAnalyzing: false,
        panelOpen: false,
    },
});

export const toggleMixAnalysisPanel = (): void => {
    const state = mixAnalysisStore.value;
    if (!state) {
        return;
    }
    mixAnalysisStore.set({ ...state, panelOpen: !state.panelOpen });
};
