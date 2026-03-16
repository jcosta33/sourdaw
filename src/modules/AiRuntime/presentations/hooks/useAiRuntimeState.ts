import { useSyncExternalStore } from "react";
import { aiRuntimeStore, type AiRuntimeStoreState } from "../../stores/aiRuntimeStore";

const defaultState: AiRuntimeStoreState = {
    status: "idle",
    lastError: null,
    browserModelReady: false,
};

export const useAiRuntimeState = (): AiRuntimeStoreState => {
    return useSyncExternalStore(
        (onChange) => aiRuntimeStore.subscribe(() => onChange()),
        () => aiRuntimeStore.value ?? defaultState,
        () => aiRuntimeStore.value ?? defaultState,
    );
};
