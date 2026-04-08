/**
 * useTransportState — local re-implementation using transportStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { transportStore, defaultTransportState, type TransportState } from '#/modules/Transport';

export const useTransportState = (): TransportState => {
    return useStore(transportStore, defaultTransportState);
};
