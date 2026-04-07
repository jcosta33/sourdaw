/**
 * useTransportState — local re-implementation using transportStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { defaultTransportState, type TransportState } from '#/modules/Transport/useCases/transportQueries';

export const useTransportState = (): TransportState => {
    return useStore(transportStore, defaultTransportState);
};
