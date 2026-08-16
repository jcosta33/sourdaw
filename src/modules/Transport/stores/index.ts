// Transport/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { playheadPositionRef } from './playheadPositionRef';

export type { TempoMapStoreState } from './tempoMapStore';
export { tempoMapStore, MIN_TEMPO_MAP_TEMPO } from './tempoMapStore';

export type { TimeSignatureMapStoreState } from './timeSignatureMapStore';
export { timeSignatureMapStore } from './timeSignatureMapStore';

export { transportStore, defaultTransportState, MIN_TEMPO, MAX_TEMPO } from './transportStore';
export type { TransportState } from './transportStore';

export type { LinkStatus } from './linkStatusStore';
export { linkStatusStore, defaultLinkStatus, subscribeToLinkStatus, getLinkStatusSnapshot } from './linkStatusStore';
