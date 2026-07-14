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

export const emptySnapshotMarkers = {
    markers: [],
    sections: [],
} satisfies NonNullable<ArrangementSnapshot['markers']>;

export const emptySnapshotTakeLanes = {
    lanes: [],
} satisfies NonNullable<ArrangementSnapshot['takeLanes']>;
