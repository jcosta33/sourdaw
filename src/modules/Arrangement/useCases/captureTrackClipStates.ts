import { midiStore } from '#/modules/MIDI/stores';
import {
    type MidiCcSnapshot,
    type MidiNotesSnapshot,
    type MidiPitchBendSnapshot,
    type TrackClipStateSnapshot,
} from '#/utils/handlerContract';

import { collectTrackClipIds } from '../services/collectTrackClipIds';

import { getTrackStoreState } from './getTrackStoreState';

/**
 * Snapshot named tracks' clip collections plus the MIDI satellite state those
 * clips (and their hidden alternatives) own — the general primitive `cutClip`,
 * `pasteClip` and `stripSilence` build their guarded restore on. A pure read:
 * callers snapshot before a write for `expected`, and again after for
 * `replacement`, via two separate calls.
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

        const midiNotesByClipId: Record<string, MidiNotesSnapshot> = {};
        const midiCcByClipId: Record<string, MidiCcSnapshot> = {};
        const midiPitchBendByClipId: Record<string, MidiPitchBendSnapshot> = {};
        if (midiState) {
            // Includes alternative-lane clip ids, not just the active `track.clips`
            // sequence: MIDI satellite data is addressed by clip id regardless of
            // which lane currently owns it, and a restore that dropped a hidden
            // alternative's notes would silently corrupt it the next time that
            // alternative became active.
            for (const clipId of collectTrackClipIds(track)) {
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

        snapshots.push({ trackId, clips, midiNotesByClipId, midiCcByClipId, midiPitchBendByClipId });
    }

    return snapshots;
}
