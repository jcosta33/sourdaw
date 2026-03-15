import { useSyncExternalStore } from "react";
import { transportStore } from "../../stores/transportStore";
import { defaultTransportState, type TransportState } from "../../models/TransportState";

export const useTransportState = (): TransportState => {
    return useSyncExternalStore(
        (onChange) => transportStore.subscribe(() => onChange()),
        () => transportStore.value ?? defaultTransportState,
        () => transportStore.value ?? defaultTransportState,
    );
};
