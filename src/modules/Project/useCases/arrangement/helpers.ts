import { type TrackStoreState } from '#/modules/Arrangement/stores';

import { type ArrangementSnapshot } from '../../stores/arrangementStore';

export const emptySnapshotTracks = {
    tracks: [],
    selectedTrackId: null,
} satisfies ArrangementSnapshot['tracks'];

export const emptySnapshotAutomation = {
    lanes: [],
} satisfies ArrangementSnapshot['automation'];

export const emptySnapshotMidi = {
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
} satisfies ArrangementSnapshot['midi'];

/**
 * The tracks section of a snapshot: exactly the keys an arrangement persists.
 *
 * The live track store also holds view state — the assistant's proposed ghost
 * clips — that a snapshot must not carry. `arrangementStore` rebuilds the
 * section without those keys on the way in, so persisting them writes content
 * the projection can never return, and the raw projection-loss detector reads
 * that as a corrupt document: repair-required, every edit and every save
 * refused. Returning the section type keeps this list and the persisted shape
 * one thing, so a new persisted key fails to compile here instead of silently
 * going missing.
 */
export function pickPersistedTracksSection(state: TrackStoreState): ArrangementSnapshot['tracks'] {
    return { tracks: state.tracks, selectedTrackId: state.selectedTrackId };
}
