/**
 * useTransportState — TimelineEditor-local subscription to the canonical
 * transportStore (a public contract). Uses the canonical `TransportState`
 * type from Transport so any field addition/rename propagates. Mirrors the
 * per-module hook duplication pattern used across the app.
 */
import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState } from '#/modules/Transport/useCases';

type TransportState = typeof defaultTransportState;

export const useTransportState = (): TransportState => {
    return useStore(transportStore, defaultTransportState);
};
