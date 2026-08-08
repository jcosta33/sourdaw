import { splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';
import { type ClipStateSnapshot } from '#/utils/handlerContract';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';

import { prepareClipSplit } from './prepareClipSplit';

function cloneClipStateSnapshot(snapshot: ClipStateSnapshot): Clip {
    return {
        ...structuredClone(snapshot),
        overrides: snapshot.overrides ? { ...snapshot.overrides } : undefined,
        kneadState: snapshot.kneadState
            ? {
                  ...snapshot.kneadState,
                  blobs: snapshot.kneadState.blobs.map((blob) => ({
                      ...blob,
                      pitchCurveCents: [...blob.pitchCurveCents],
                  })),
              }
            : undefined,
    };
}

/**
 * Split a clip at `splitBeat` (zero-crossing snapped for audio). The left half
 * keeps the original clip id; the right half gets a fresh id unless
 * `rightClipId` is provided — redo paths pass the id the original split
 * produced so stacked splits on the same lineage stay addressable. Returns the
 * right clip id, or null when the split is rejected.
 */
export function splitClip(
    clipId: string,
    splitBeat: number,
    rightClipId?: string,
    targetNoteIds?: readonly string[],
    resolvedSplitBeat?: number
): string | null {
    if (!Number.isFinite(splitBeat)) {
        return null;
    }
    if (rightClipId !== undefined && (typeof rightClipId !== 'string' || rightClipId.length === 0)) {
        return null;
    }

    const plan = prepareClipSplit({ clipId, splitBeat, rightClipId, resolvedSplitBeat, targetNoteIds });
    const state = getTrackState();
    if (!plan || !state || !plan.next.rightClip) {
        return null;
    }
    const leftClip = cloneClipStateSnapshot(plan.next.leftClip);
    const rightClip = cloneClipStateSnapshot(plan.next.rightClip);
    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            if (track.id !== plan.next.trackId) {
                return track;
            }
            return {
                ...track,
                clips: track.clips.map((clip) => (clip.id === clipId ? leftClip : clip)).concat(rightClip),
            };
        }),
    });
    if (plan.next.leftClip.type === 'midi') {
        splitMidiNotesAtBeat({
            sourceClipId: clipId,
            newClipId: plan.rightClipId,
            splitBeat: plan.adjustedMediaSplit,
            targetNoteIds: plan.targetNoteIds,
        });
    }
    return plan.rightClipId;
}
