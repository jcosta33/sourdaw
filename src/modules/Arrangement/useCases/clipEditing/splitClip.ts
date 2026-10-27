import { restoreAutomationLanes } from '#/modules/Automation/useCases';
import { splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';
import { type ClipStateSnapshot } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { writeClipSatelliteEntry } from '../../stores/clipSatelliteState';
import { type Clip } from '../../stores/trackStore';
import { applyTakeReKeyTransitions } from '../comping/applyTakeReKeyTransitions';
import { captureClipSplitTakeReKeyTransitions } from '../comping/captureClipSplitTakeReKey';
import { reKeyedTakeLaneOwnersMatchStore } from '../comping/reKeyedTakeLaneOwnersMatchStore';
import { type TakeReKeyLaneTransition } from '../comping/takeReKeyTransition';

import { prepareClipSplit } from './prepareClipSplit';

type SplitClipOptions = {
    /**
     * Spliced with the take-lane re-key transitions the split captures (#5048),
     * so the caller's undo/redo legs can restore and re-apply them: the split's
     * inverse is a snapshot restore, not a re-split, and only the capture holds
     * both facets. The split applies the transitions itself either way.
     */
    reKeyedTakeLanes?: TakeReKeyLaneTransition[];
    prepared?: NonNullable<ReturnType<typeof prepareClipSplit>>;
};

function cloneClipStateSnapshot(snapshot: ClipStateSnapshot): Clip {
    const { overrides, kneadState, ...snapshotClip } = structuredClone(snapshot);
    const clip: Clip = snapshotClip;
    if (Object.hasOwn(snapshot, 'overrides')) {
        clip.overrides = overrides ? { ...overrides } : undefined;
    }
    if (Object.hasOwn(snapshot, 'kneadState')) {
        clip.kneadState = kneadState
            ? {
                  ...kneadState,
                  blobs: kneadState.blobs.map((blob) => ({
                      ...blob,
                      pitchCurveCents: [...blob.pitchCurveCents],
                  })),
              }
            : undefined;
    }
    return clip;
}

function validSplitArguments(splitBeat: number, rightClipId?: string): boolean {
    return (
        Number.isFinite(splitBeat) &&
        (rightClipId === undefined || (typeof rightClipId === 'string' && rightClipId.length > 0))
    );
}

function splitStillOwned(
    state: NonNullable<ReturnType<typeof getTrackState>>,
    plan: NonNullable<ReturnType<typeof prepareClipSplit>>,
    clipId: string
): boolean {
    const track = state.tracks.find((candidate) => candidate.id === plan.previous.trackId);
    const current = track?.clips.find((candidate) => candidate.id === clipId);
    return Boolean(
        current &&
        valuesEqual(current, plan.previous.leftClip) &&
        !state.tracks.some((candidate) => candidate.clips.some((clip) => clip.id === plan.rightClipId)) &&
        (!plan.takeReKeyTransitions || reKeyedTakeLaneOwnersMatchStore(plan.takeReKeyTransitions, 'apply'))
    );
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
    resolvedSplitBeat?: number,
    options?: SplitClipOptions
): string | null {
    if (!validSplitArguments(splitBeat, rightClipId)) {
        return null;
    }

    const captured = options?.prepared;
    const plan =
        captured?.previous.leftClip.type === 'audio'
            ? captured
            : prepareClipSplit({ clipId, splitBeat, rightClipId, resolvedSplitBeat, targetNoteIds });
    const state = getTrackState();
    if (!plan || !state || !plan.next.rightClip) {
        return null;
    }
    if (!splitStillOwned(state, plan, clipId)) {
        return null;
    }
    // #5048 — splitting changes no audio: takes and comp regions re-key onto
    // both fragments the way Delete Time re-keys them (#4841), so a region
    // spanning the seam keeps sounding its take across both fragments instead
    // of staying bounded by the left clip's end. Captured before any write,
    // applied right after the clip state publishes.
    const takeReKeyTransitions =
        plan.takeReKeyTransitions ??
        captureClipSplitTakeReKeyTransitions({
            sourceClip: cloneClipStateSnapshot(plan.previous.leftClip),
            trackId: plan.next.trackId,
            clipId,
            rightClipId: plan.rightClipId,
            splitBeat: plan.next.leftClip.endBeat,
            clipStartBeat: plan.previous.leftClip.startBeat,
            clipEndBeat: plan.previous.leftClip.endBeat,
            sourceMidi: plan.previous.sourceMidi,
        });
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
    if (takeReKeyTransitions.length > 0) {
        applyTakeReKeyTransitions(takeReKeyTransitions);
        const reKeyedTakeLanes = options?.reKeyedTakeLanes;
        reKeyedTakeLanes?.splice(0, reKeyedTakeLanes.length, ...takeReKeyTransitions);
    }
    if (plan.next.leftClip.type === 'midi') {
        splitMidiNotesAtBeat({
            sourceClipId: clipId,
            newClipId: plan.rightClipId,
            splitBeat: plan.adjustedMediaSplit,
            targetNoteIds: plan.targetNoteIds,
        });
    }
    if (plan.next.clipSatellites) {
        for (const entry of plan.next.clipSatellites) {
            writeClipSatelliteEntry(entry);
        }
    }
    // The right fragment's clip-scoped automation lanes travel with it (the
    // copy ids derive from the right clip id, so a redo re-split reproduces
    // them exactly). The left half's lanes are untouched, and an undo of this
    // split retires the copies with the right clip itself (`removeClip` →
    // `removeClipSatelliteData`).
    if (plan.next.clipAutomationLanes && plan.next.clipAutomationLanes.length > 0) {
        restoreAutomationLanes(plan.next.clipAutomationLanes);
    }
    return plan.rightClipId;
}
