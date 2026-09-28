import { type TakeReKeyClipGeometry, type TakeReKeyClipWindow } from './takeReKeyTransition';

type CollectTakeReKeyWindowsInput = {
    /** Tracks the operation rewrites, with their pre-operation clips. */
    beforeTracks: readonly { trackId: string; clips: readonly TakeReKeyClipGeometry[] }[];
    /** Every track's post-operation clips, indexed for lookup. */
    afterTracks: readonly { trackId: string; clips: readonly TakeReKeyClipGeometry[] }[];
    /** Source clip id → the fresh id its re-keyed or split-off right fragment carries. */
    reKeyTargets: ReadonlyMap<string, string>;
    deleteStartBeat: number;
};

/**
 * Which part of a clip's pre-delete span a surviving fragment carries, derived
 * from the clip and the fragment alone. A fragment as long as the clip carries
 * it whole (a pure shift); a fragment still anchored at the clip's start whose
 * span ends at or before the deletion is the left survivor; anything else is
 * the right survivor, anchored at the clip's end. The deleted span itself is
 * never part of a window — it is the gap between them.
 */
function createFragmentWindow(
    clip: TakeReKeyClipGeometry,
    fragment: TakeReKeyClipGeometry,
    deleteStartBeat: number
): TakeReKeyClipWindow {
    const fragmentLength = fragment.endBeat - fragment.startBeat;
    const clipLength = clip.endBeat - clip.startBeat;
    let sourceStartBeat: number;
    if (fragmentLength === clipLength) {
        sourceStartBeat = clip.startBeat;
    } else if (fragment.startBeat === clip.startBeat && clip.startBeat + fragmentLength <= deleteStartBeat) {
        sourceStartBeat = clip.startBeat;
    } else {
        sourceStartBeat = clip.endBeat - fragmentLength;
    }
    return {
        sourceClipId: clip.id,
        targetClipId: fragment.id,
        sourceStartBeat,
        sourceEndBeat: sourceStartBeat + fragmentLength,
        targetStartBeat: fragment.startBeat,
    };
}

function isIdentityWindow(clip: TakeReKeyClipGeometry, window: TakeReKeyClipWindow): boolean {
    return (
        window.targetClipId === clip.id &&
        window.sourceStartBeat === clip.startBeat &&
        window.sourceEndBeat === clip.endBeat &&
        window.targetStartBeat === clip.startBeat
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
                const window = createFragmentWindow(clip, sameIdFragment, input.deleteStartBeat);
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
            windows.push(createFragmentWindow(clip, fragment, input.deleteStartBeat));
        }
        if (windows.length > 0) {
            windowsByTrackId.set(beforeTrack.trackId, windows);
        }
    }
    return windowsByTrackId;
}
