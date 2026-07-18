/**
 * useTransportState — subscribe to the canonical transportStore.
 *
 * §12.2 — previously declared a local TransportViewState that had to be
 * hand-synced with TransportState. Use the canonical type from
 * \`#/modules/Transport\` so any field addition/rename propagates.
 */
import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

type TransportState = typeof defaultTransportState;
export const useTransportState = (): TransportState => {
    return useStore(transportStore, defaultTransportState);
};
