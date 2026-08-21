import { midiStore } from '#/modules/MIDI/stores';
import {
    type MidiCcSnapshot,
    type MidiNotesSnapshot,
    type MidiPitchBendSnapshot,
    type TrackClipStateSnapshot,
} from '#/utils/handlerContract';

import { collectTrackClipIds } from '../services/collectTrackClipIds';
import { readClipSatelliteEntry } from '../stores/clipSatelliteState';

import { readClipScopedAutomationLanes } from './clip/readClipScopedAutomationLanes';
import { getTrackStoreState } from './getTrackStoreState';

/**
 * Snapshot named tracks' clip collections and everything a collection rewrite
 * destroys alongside them — the general primitive `cutClip`, `pasteClip`,
 * `flattenTrack` and `consolidateAllTracks` build their guarded restore on. A pure
 * read: callers snapshot before a write for `expected`, and again after for
 * `replacement`, via two separate calls.
 *
 * "Everything" is load-bearing, and each part is here because a forward path
 * removes it:
 *
 * - **Track fields.** `flattenTrack` rewrites `kind`, `devices`, the freeze state
 *   and the alternative lanes; a `destination: 'replace'` bounce empties `devices`.
 * - **MIDI satellites**, addressed by clip id across every lane including hidden
 *   alternatives — a restore that dropped a hidden alternative's notes would
 *   corrupt it the next time that alternative became active.
 * - **Clip satellites and clip-scoped automation lanes.** `removeClip` calls
 *   `removeClipSatelliteData`, which deletes a clip's gain envelope, its warp
 *   state, and every automation lane keyed to it. Cut reaches that path directly,
 *   and so does whatever a paste displaces.
 *
 * `stripSilence` is deliberately not one of the callers: it owns a purpose-built
 * inverse in `restoreStripSilenceState`, which *migrates* clip-scoped automation
 * lanes onto the segments it produced. This snapshot restores lanes to the clips
 * they were captured against and cannot express that re-keying.
 *
 * A track id absent from the live store is skipped rather than throwing —
 * `describe()` runs before `execute()`, so a track already gone by the time
 * undo replays is exactly the divergence `handleRestoreTrackClipStates`
 * refuses on, not a capture-time error.
 */
export function captureTrackClipStates(trackIds: readonly string[]): TrackClipStateSnapshot[] {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return [];
    }
    const midiState = midiStore.value;

    const snapshots: TrackClipStateSnapshot[] = [];
    for (const trackId of trackIds) {
        const track = trackState.tracks.find((candidate) => candidate.id === trackId);
        if (!track) {
            continue;
        }

        const clips = structuredClone(track.clips);
        const clipIds = collectTrackClipIds(track);

        const midiNotesByClipId: Record<string, MidiNotesSnapshot> = {};
        const midiCcByClipId: Record<string, MidiCcSnapshot> = {};
        const midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot> = {};
        if (midiState) {
            for (const clipId of clipIds) {
                if (midiState.notesByClipId[clipId]) {
                    midiNotesByClipId[clipId] = structuredClone(midiState.notesByClipId[clipId]);
                }
                if (midiState.ccByClipId[clipId]) {
                    midiCcByClipId[clipId] = structuredClone(midiState.ccByClipId[clipId]);
                }
                if (midiState.pitchBendByClipId[clipId]) {
                    midiPitchBendByClipId[clipId] = structuredClone(midiState.pitchBendByClipId[clipId]);
                }
            }
        }

        const clipSatellites = clipIds
            .map((clipId) => readClipSatelliteEntry(clipId))
            .filter((entry) => entry.gainEnvelope !== null || entry.warpState !== null);
        const clipAutomationLanes = structuredClone(readClipScopedAutomationLanes(clipIds));

        snapshots.push({
            trackId,
            clips,
            trackFields: structuredClone({
                kind: track.kind,
                devices: track.devices,
                frozen: track.frozen,
                ...(track.frozenBufferId === undefined ? {} : { frozenBufferId: track.frozenBufferId }),
                freezeState: track.freezeState,
                activeAlternativeId: track.activeAlternativeId,
                alternatives: track.alternatives,
            }),
            midiNotesByClipId,
            midiCcByClipId,
            midiPitchBendByClipId,
            clipSatellites,
            clipAutomationLanes,
        });
    }

    return snapshots;
}
