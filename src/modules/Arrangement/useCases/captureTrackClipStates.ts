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
import { captureRetiredTakeLanes } from './comping/captureRetiredTakeLanes';
import { getTrackStoreState } from './getTrackStoreState';

/**
 * Snapshot named tracks' clip collections and everything a collection rewrite
 * destroys alongside them — the general primitive `cutClip`, `pasteClip`,
 * `flattenTrack` and `consolidateAllTracks` build their guarded restore on. A pure
 * read, taken via two separate calls: `expected` is what the store is expected to
 * hold at the moment the restore runs, and `replacement` is what it should hold
 * afterwards. For an inverse action that is the post-write state and the pre-write
 * state respectively; for a redo it is the other way round.
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
 *
 * `retiringClipIds` names the pre-existing clips whose removal retires takes
 * through `removeClip`, so the capture can carry the lanes that removal will
 * retire and undo can put them back; a capture that names any carries the
 * `retiredTakeLanes` key even when it found none, which is how the restore tells
 * a take-retiring route from one that never captured. `cutClip` passes it for
 * the clips it removes directly; `flattenTrack` and `consolidateAllTracks` pass
 * the clip ids their forwards replace and retire those takes through
 * `removeTakesForClips`, since their collection rewrite never reaches
 * `removeClip`. `pasteClip` removes only ids it minted moments earlier.
 *
 * Two routes still drop pre-existing clips without retiring their takes, and
 * that gap is filed rather than covered here: Delete Time and Delete Time Range
 * drop clips through `removeClipSatelliteData` alone, and undoing the
 * `splitClip` action removes the right half directly. The orphan comp region
 * then advances the comp cursor, so the replacement clip is silent over that
 * span in live playback and in the offline render. The time routes are defect
 * #4520 and the split action's undo is #4521; this capture deliberately does
 * not extend either of them.
 */
export function captureTrackClipStates(
    trackIds: readonly string[],
    retiringClipIds: readonly string[] = []
): TrackClipStateSnapshot[] {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return [];
    }
    const midiState = midiStore.value;
    const retiringClipIdSet = new Set(retiringClipIds);

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
        const trackRetiringClipIds = track.clips
            .filter((clip) => retiringClipIdSet.has(clip.id))
            .map((clip) => clip.id);

        const snapshot: TrackClipStateSnapshot = {
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
        };
        // A capture that names no retiring clip belongs to a route that retires no
        // take-lane state, so the key is omitted entirely rather than left empty:
        // the restore reads its presence to decide whether a redo may re-retire
        // takes for the clips it drops, and an empty capture must not be
        // indistinguishable from "this route never captured".
        if (trackRetiringClipIds.length === 0) {
            snapshots.push(snapshot);
            continue;
        }
        snapshots.push({ ...snapshot, retiredTakeLanes: captureRetiredTakeLanes(trackRetiringClipIds) });
    }

    return snapshots;
}
