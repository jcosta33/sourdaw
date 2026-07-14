import { describe, expect, it } from 'vitest';

import {
    emptySnapshotAutomation,
    emptySnapshotMarkers,
    emptySnapshotMidi,
    emptySnapshotTakeLanes,
    emptySnapshotTracks,
} from '../helpers';

describe('arrangement snapshot helper defaults', () => {
    it('should expose empty snapshot fallback shapes', () => {
        expect(emptySnapshotTracks).toEqual({ tracks: [], selectedTrackId: null });
        expect(emptySnapshotAutomation).toEqual({ lanes: [] });
        expect(emptySnapshotMidi).toEqual({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        expect(emptySnapshotMarkers).toEqual({ markers: [], sections: [] });
        expect(emptySnapshotTakeLanes).toEqual({ lanes: [] });
    });
});
