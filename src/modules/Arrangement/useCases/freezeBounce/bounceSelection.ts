import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import {
    getMidiStoreState,
    removeMidiClipData,
    restoreMidiClipData,
    splitMidiNotesAtBeat,
} from '#/modules/MIDI/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Clip } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

import { detectSilentBake } from './detectSilentBake';
import { renderTrackOffline, type RenderScheduleTally } from './renderOffline';

/** Frozen notes/CC/pitch-bend for one clip id; null when the key is absent. */
type MidiClipDataSnapshot = {
    notes: readonly unknown[] | null;
    controlChanges: readonly unknown[] | null;
    pitchBends: readonly unknown[] | null;
};

function captureMidiClipData(clipId: string): MidiClipDataSnapshot {
    const state = getMidiStoreState();
    const notes = state?.notesByClipId[clipId];
    const controlChanges = state?.ccByClipId[clipId];
    const pitchBends = state?.pitchBendByClipId[clipId];
    return {
        notes: notes ? structuredClone(notes) : null,
        controlChanges: controlChanges ? structuredClone(controlChanges) : null,
        pitchBends: pitchBends ? structuredClone(pitchBends) : null,
    };
}

/**
 * Reinstate a frozen snapshot: an all-null snapshot means the clip had no
 * MIDI data at capture time, so any entries written since are removed
 * (restoreMidiClipData's nulls mean "leave as-is", never delete).
 */
function applyMidiClipDataSnapshot(clipId: string, snapshot: MidiClipDataSnapshot): void {
    if (snapshot.notes === null && snapshot.controlChanges === null && snapshot.pitchBends === null) {
        removeMidiClipData([clipId]);
        return;
    }
    restoreMidiClipData({
        clipId,
        notesSnapshot: snapshot.notes ? structuredClone(snapshot.notes) : null,
        controlChangeSnapshot: snapshot.controlChanges ? structuredClone(snapshot.controlChanges) : null,
        pitchBendSnapshot: snapshot.pitchBends ? structuredClone(snapshot.pitchBends) : null,
    });
}

export async function bounceSelection(trackId: string, startBeat: number, endBeat: number): Promise<boolean> {
    // Selection bounce uses hardcoded options for now, but could be extended
    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track) {
        return false;
    }

    const clipsInRange = track.clips.filter((context) => context.endBeat > startBeat && context.startBeat < endBeat);
    if (clipsInRange.length === 0) {
        return false;
    }

    let scheduleTally: RenderScheduleTally = { scheduledNotes: 0, scheduledBuffers: [], withheldDeviceTypes: [] };
    const renderedBuffer = await renderTrackOffline(track, startBeat, endBeat, {
        onScheduled: (tally) => {
            scheduleTally = tally;
        },
    });

    if (!renderedBuffer) {
        return false;
    }

    // The most destructive of the four bake paths: it replaces clips *and*
    // calls `removeMidiClipData`, so the notes are gone from the MIDI store
    // outright rather than merely detached from the track. The renderer keeps
    // the original track so stateful devices receive pre-region history; its
    // tally boundary still observes only sources reaching the returned range.
    const silentBake = detectSilentBake({
        track,
        buffer: renderedBuffer,
        tally: scheduleTally,
        // Defaults: `targetMixer: 'bake'` with automation included, so the
        // track's fader and its lanes are both folded into the samples.
        bakedFaderGain: track.gain,
        bakesAutomation: true,
        operation: 'Bounce',
    });
    if (silentBake.silentBake) {
        notifyUser(silentBake.message, 'error');
        return false;
    }

    const freshTarget = resolveEligibleClipWriteTarget({ trackId });
    if (freshTarget.status !== 'eligible') {
        return false;
    }

    const freshState = trackStore.value;
    if (!freshState) {
        return false;
    }

    const targetTrackIndex = freshState.tracks.findIndex((candidate) => candidate.id === freshTarget.trackId);
    if (targetTrackIndex === -1) {
        return false;
    }

    const targetTrack = freshState.tracks[targetTrackIndex]!;

    // Partial overlaps are split at the selection edges so out-of-range
    // material survives (ledger M-031) — same split convention as
    // deleteTimeRange (#608). Fully-inside clips are removed with their
    // MIDI data cleaned. Notes are clip-relative, so kept parts keep their
    // alignment via media-beat partitioning below.
    const keptClips: Clip[] = [];
    const removedMidiClipIds: string[] = [];
    const sourceMidiClipIds: string[] = [];
    const generatedMidiClipIds: string[] = [];
    const splitOps: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }> = [];

    for (const clip of targetTrack.clips) {
        if (clip.endBeat <= startBeat || clip.startBeat >= endBeat) {
            keptClips.push(clip);
            continue;
        }
        if (clip.type === 'midi') {
            sourceMidiClipIds.push(clip.id);
        }
        if (clip.startBeat >= startBeat && clip.endBeat <= endBeat) {
            // Fully inside the selection: replaced by the bounce.
            removedMidiClipIds.push(clip.id);
            continue;
        }
        if (clip.startBeat < startBeat && clip.endBeat > endBeat) {
            // Spans the selection: keep both outside parts.
            const rightClipId = `clip-bsel-${crypto.randomUUID().slice(0, 8)}`;
            keptClips.push(
                { ...clip, endBeat: startBeat, name: `${clip.name} (L)` },
                {
                    ...clip,
                    id: rightClipId,
                    startBeat: endBeat,
                    name: `${clip.name} (R)`,
                    audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                    midiOffsetBeats: 0,
                }
            );
            if (clip.type === 'midi') {
                generatedMidiClipIds.push(rightClipId);
                splitOps.push({
                    sourceClipId: clip.id,
                    newClipId: rightClipId,
                    splitBeat: endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                    discardBeforeBeat: startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                });
            }
            continue;
        }
        if (clip.startBeat < startBeat) {
            // Crosses the left edge: keep the left part; in-selection notes
            // move to a throwaway id and are removed.
            keptClips.push({ ...clip, endBeat: startBeat });
            if (clip.type === 'midi') {
                const mediaSplit = startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                const discardId = `clip-bsel-discard-${crypto.randomUUID().slice(0, 8)}`;
                generatedMidiClipIds.push(discardId);
                splitOps.push({
                    sourceClipId: clip.id,
                    newClipId: discardId,
                    splitBeat: mediaSplit,
                    discardBeforeBeat: mediaSplit,
                });
                removedMidiClipIds.push(discardId);
            }
            continue;
        }
        // Crosses the right edge: keep the right part, re-based to endBeat on
        // a fresh id (its MIDI media starts at the split point).
        const rightClipId = `clip-bsel-${crypto.randomUUID().slice(0, 8)}`;
        keptClips.push({
            ...clip,
            id: rightClipId,
            startBeat: endBeat,
            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
            midiOffsetBeats: 0,
        });
        if (clip.type === 'midi') {
            generatedMidiClipIds.push(rightClipId);
            const mediaSplit = endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
            splitOps.push({
                sourceClipId: clip.id,
                newClipId: rightClipId,
                splitBeat: mediaSplit,
                discardBeforeBeat: mediaSplit,
            });
            removedMidiClipIds.push(clip.id);
        }
    }

    // Freeze the MIDI data the split/remove mutations below touch, or the
    // track-only undo would permanently destroy notes (PR #621 review —
    // pre-split the op never touched midiStore). Source entries are frozen
    // before mutation; generated entries (kept right parts, throwaway
    // discards) are frozen after so redo reinstates them.
    const midiSnapshotsBefore = new Map<string, MidiClipDataSnapshot>();
    for (const clipId of sourceMidiClipIds) {
        midiSnapshotsBefore.set(clipId, captureMidiClipData(clipId));
    }

    const tracksBefore = structuredClone(freshState.tracks);

    const audioBufferId = `bounce-sel-${trackId}-${Date.now()}`;
    cacheAudioBuffer({ buffer: renderedBuffer, bufferId: audioBufferId });

    const bouncedClip: Clip = {
        id: `bounced-sel-${crypto.randomUUID()}`,
        trackId,
        name: `${track.name} (selection bounce)`,
        startBeat,
        endBeat,
        type: 'audio',
        audioBufferId,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1.0,
        color: '',
        locked: false,
        muted: false,
    };

    const tracksAfterBounce = freshState.tracks.slice();
    tracksAfterBounce[targetTrackIndex] = {
        ...targetTrack,
        clips: [...keptClips, bouncedClip],
    };
    trackStore.set({
        ...freshState,
        tracks: tracksAfterBounce,
    });

    for (const op of splitOps) {
        splitMidiNotesAtBeat(op);
    }
    for (const clipId of removedMidiClipIds) {
        removeMidiClipData([clipId]);
    }

    const midiSnapshotsAfter = new Map<string, MidiClipDataSnapshot>();
    for (const clipId of [...sourceMidiClipIds, ...generatedMidiClipIds]) {
        midiSnapshotsAfter.set(clipId, captureMidiClipData(clipId));
    }

    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Selection',
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksBefore });
            }
            // Reinstate the pre-bounce note data: source clips get their
            // original entries back; generated ids (right parts, discards)
            // did not exist before the bounce and are removed.
            for (const [clipId, snapshot] of midiSnapshotsBefore) {
                applyMidiClipDataSnapshot(clipId, snapshot);
            }
            removeMidiClipData(generatedMidiClipIds);
        },
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksAfter });
            }
            // Reinstate the post-bounce partition: split entries and kept
            // right parts return exactly as the op wrote them; removed
            // entries (inside clips, throwaway discards) are all-null
            // snapshots and are removed again.
            for (const [clipId, snapshot] of midiSnapshotsAfter) {
                applyMidiClipDataSnapshot(clipId, snapshot);
            }
        }
    );
    return true;
}
