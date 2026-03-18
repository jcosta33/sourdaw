/**
 * useTransportState — local re-implementation using transportStore (contract).
 */
import { useSyncExternalStore } from 'react';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { defaultTransportState, type TransportState } from '../../useCases/workspaceViewActions';

export const useTransportState = (): TransportState => {
    return useSyncExternalStore(
        (onChange) => transportStore.subscribe(() => onChange()),
        () => transportStore.value ?? defaultTransportState,
        () => transportStore.value ?? defaultTransportState
    );
};
