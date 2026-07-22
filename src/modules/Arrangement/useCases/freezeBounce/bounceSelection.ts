import { cacheAudioBuffer } from '#/modules/AudioEngine/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { removeMidiClipData, splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { type Clip, type Track } from '../../models/Track';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';

import { renderTrackOffline } from './renderOffline';

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

    const virtualTrack: Track = {
        ...track,
        clips: clipsInRange.map((context) => ({
            ...context,
            startBeat: Math.max(context.startBeat, startBeat),
            endBeat: Math.min(context.endBeat, endBeat),
        })),
    };

    const renderedBuffer = await renderTrackOffline(virtualTrack, startBeat, endBeat);

    if (!renderedBuffer) {
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

    const tracksAfter = structuredClone(trackStore.value?.tracks ?? []);
    pushUndoEntry(
        'Bounce Selection',
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksBefore });
            }
        },
        () => {
            const state1 = trackStore.value;
            if (state1) {
                trackStore.set({ ...state1, tracks: tracksAfter });
            }
        }
    );
    return true;
}
