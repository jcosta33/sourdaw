// Arrangement/events — public contract surface for domain event types.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export type { TrackAddedPayload } from './TrackAddedEvent';
export type { TrackRemovedPayload } from './TrackRemovedEvent';
export type { FreezeStateChangedPayload } from './FreezeStateChangedEvent';
export type { TrackSelectionChangedPayload } from './TrackSelectionChangedEvent';
