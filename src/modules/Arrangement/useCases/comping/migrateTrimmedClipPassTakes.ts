import { type Take } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore, type Clip } from '../../stores/trackStore';

/** A clip's own media offset, in the field its readers read. */
function clipOwnMediaOffset(clip: Clip): number {
    return clip.type === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
}

/**
 * Whether a start trim consumed the head of a pass take's span.
 *
 * A loop pass saved before pass placement existed keeps its take spanning the
 * loop it was recorded over, so a start trim that moved its clip's start past
 * the take's start can only be a trim the take never followed (#4996): commit
 * opens a recording clip at or before its passes' starts, and the only move
 * that separates them leftward is a trim on a build that did not carry takes
 * along. A start trim advances the clip's start and its media offset by the
 * same delta, so the clip's media origin (`startBeat − offset`) never moves;
 * a slip of the clip's content writes an offset with no trim and moves the
 * origin alone, leftward past the take's span start. The origin sitting at or
 * before that start is therefore the trim's fingerprint — a positive offset
 * alone is not, since a slip writes one too. Equality belongs to the trim: a
 * recording begun exactly at the take's span start trims to origin == start,
 * and the slip that lands exactly there is byte-identical to it, so geometry
 * cannot split them and the repair side wins. The trim must also leave the
 * take a surviving span: a clip start at or past the take's end consumed the
 * whole take, and clamping would invert it.
 */
function isUnfollowedTrimStart(take: Take, clip: Clip | undefined): clip is Clip {
    return (
        clip !== undefined &&
        take.sourceOffsetBeats !== undefined &&
        take.startBeat < clip.startBeat &&
        clip.startBeat < take.endBeat &&
        clip.startBeat - clipOwnMediaOffset(clip) <= take.startBeat
    );
}

/**
 * Data migration for documents saved before start trims carried loop passes
 * along (#4996): clamps every pass take a start trim left behind to its clip's
 * start, so the take no longer spans the material the user trimmed away.
 *
 * Runs on every project load, after hydration. The read is geometric and
 * self-idempotent — a clamped take starts at its clip, so no later load
 * qualifies it again — and the write lands only when a take moved, so a
 * current document round-trips untouched. The take's media depth and a placed
 * pass's seconds fields ride along untouched: comp resolution anchors a pass's
 * material at its clip's start regardless of the take's span, so the clamp
 * changes what the take lane shows and what a take-anchored reader would read,
 * never what the clip sounds today. Figures whose media origin sits strictly
 * past the take's span start stay untouched, because a slip lands there just
 * as a trim of a recording begun mid-loop does — the geometry cannot split
 * them. A looped MIDI clip's trim also wraps its offset by whole loop lengths
 * in `trimClipStart`, walking the media origin the same slipward direction.
 * All of those stay undetectable here; #4988's loop-origin record is the door
 * to those.
 */
export function migrateTrimmedClipPassTakes(): void {
    const laneState = takeLaneStore.value;
    const trackState = trackStore.value;
    if (!laneState || !trackState) {
        return;
    }

    const clipsById = new Map(trackState.tracks.flatMap((track) => track.clips ?? []).map((clip) => [clip.id, clip]));

    let changed = false;
    const lanes = laneState.lanes.map((lane) => {
        let laneChanged = false;
        const takes = lane.takes.map((take) => {
            const clip = clipsById.get(take.clipId);
            if (!isUnfollowedTrimStart(take, clip)) {
                return take;
            }
            laneChanged = true;
            return { ...take, startBeat: clip.startBeat };
        });
        if (!laneChanged) {
            return lane;
        }
        changed = true;
        return { ...lane, takes };
    });

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
