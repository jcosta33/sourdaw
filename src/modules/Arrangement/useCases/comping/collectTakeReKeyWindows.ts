import { type TakeReKeyClipGeometry, type TakeReKeyClipWindow } from './takeReKeyTransition';

type CollectTakeReKeyWindowsInput = {
    /** Tracks the operation rewrites, with their pre-operation clips. */
    beforeTracks: readonly { trackId: string; clips: readonly TakeReKeyClipGeometry[] }[];
    /** Every track's post-operation clips, indexed for lookup. */
    afterTracks: readonly { trackId: string; clips: readonly TakeReKeyClipGeometry[] }[];
    /** Source clip id → the fresh id its re-keyed or split-off right fragment carries. */
    reKeyTargets: ReadonlyMap<string, string>;
    deleteStartBeat: number;
    deleteEndBeat: number;
};

/**
 * Which part of a clip's pre-delete span a surviving fragment carries. Clips
 * outside the span survive whole; the original id on a spanning clip keeps
 * its left material, and every other overlap survivor carries the right
 * material. Use the deletion's exact edges instead of reconstructing them
 * from fragment lengths, which can round differently at fractional beats.
 */
function createFragmentWindow(
    clip: TakeReKeyClipGeometry,
    fragment: TakeReKeyClipGeometry,
    deleteStartBeat: number,
    deleteEndBeat: number
): TakeReKeyClipWindow {
    let sourceStartBeat: number;
    let sourceEndBeat: number;
    if (
        (fragment.startBeat === clip.startBeat && fragment.endBeat === clip.endBeat) ||
        clip.endBeat <= deleteStartBeat ||
        clip.startBeat >= deleteEndBeat
    ) {
        sourceStartBeat = clip.startBeat;
        sourceEndBeat = clip.endBeat;
    } else if (fragment.id === clip.id && clip.startBeat < deleteStartBeat) {
        sourceStartBeat = clip.startBeat;
        sourceEndBeat = deleteStartBeat;
    } else {
        sourceStartBeat = deleteEndBeat;
        sourceEndBeat = clip.endBeat;
    }
    return {
        sourceClipId: clip.id,
        targetClipId: fragment.id,
        sourceStartBeat,
        sourceEndBeat,
        targetStartBeat: fragment.startBeat,
        targetEndBeat: fragment.endBeat,
    };
}

function isIdentityWindow(clip: TakeReKeyClipGeometry, window: TakeReKeyClipWindow): boolean {
    return (
        window.targetClipId === clip.id &&
        window.sourceStartBeat === clip.startBeat &&
        window.sourceEndBeat === clip.endBeat &&
        window.targetStartBeat === clip.startBeat &&
        window.targetEndBeat === clip.endBeat
    );
}

/**
 * The per-track map of "where each clip's material lands" for a delete-time
 * operation, derived by diffing the clips the route prepared against the ones
 * it started from — the same transition the route already committed to, so the
 * take transform cannot drift from the clip geometry. A clip that survives
 * unchanged produces no window; its takes and regions stay as they are.
 *
 * A clip whose own id survives contributes that fragment's window (trimmed
 * left half, shifted whole clip, or the left half of a split); a clip the
 * operation re-keys or splits contributes the right fragment's window found
 * through `reKeyTargets`. Both appear for a split. Removed clips contribute
 * nothing — the retirement leg owns their takes.
 */
export function collectTakeReKeyWindows(input: CollectTakeReKeyWindowsInput): Map<string, TakeReKeyClipWindow[]> {
    const afterClipByIdByTrack = new Map<string, Map<string, TakeReKeyClipGeometry>>();
    for (const track of input.afterTracks) {
        afterClipByIdByTrack.set(track.trackId, new Map(track.clips.map((clip) => [clip.id, clip])));
    }

    const windowsByTrackId = new Map<string, TakeReKeyClipWindow[]>();
    for (const beforeTrack of input.beforeTracks) {
        const afterClips = afterClipByIdByTrack.get(beforeTrack.trackId);
        const windows: TakeReKeyClipWindow[] = [];
        for (const clip of beforeTrack.clips) {
            const sameIdFragment = afterClips?.get(clip.id);
            if (sameIdFragment) {
                const window = createFragmentWindow(clip, sameIdFragment, input.deleteStartBeat, input.deleteEndBeat);
                if (!isIdentityWindow(clip, window)) {
                    windows.push(window);
                }
            }
            const reKeyTargetId = input.reKeyTargets.get(clip.id);
            if (reKeyTargetId === undefined) {
                continue;
            }
            const fragment = afterClips?.get(reKeyTargetId);
            if (!fragment) {
                continue;
            }
            windows.push(createFragmentWindow(clip, fragment, input.deleteStartBeat, input.deleteEndBeat));
        }
        if (windows.length > 0) {
            windowsByTrackId.set(beforeTrack.trackId, windows);
        }
    }
    return windowsByTrackId;
}
