import { takeLaneStore } from '../../stores/takeLaneStore';
import { type Clip } from '../../stores/trackStore';
import { resolveClipsWithComping } from '../resolveComping';

/** One window of a clip's media, in the clip's own note coordinates. */
export type CompPlayedMediaWindow = {
    start: number;
    end: number;
};

type CollectCompPlayedMediaWindowsInput = {
    trackId: string;
    /** The clip whose media the comp layout reads. */
    clip: Clip;
    /**
     * Right edge of the surviving piece the caller keeps: everything left of a
     * timeline cut. Windows are clamped to `[clip.startBeat, pieceEndBeat)`, so
     * a region reaching past the cut contributes only the part the piece plays.
     */
    pieceEndBeat: number;
};

/**
 * The media windows of one clip that the track's comp layout actually plays
 * over its surviving left piece (#5112): every resolved comp fragment — a
 * region entering a take's pass media, or a gap continuing the clip's own —
 * mapped into the clip's note coordinates. A loop-recorded clip's passes sit
 * one lap deeper in the shared note array than the clip's own origin, so the
 * window a comped fragment plays is generally NOT the media stored at the same
 * beats, and a fragment cut by stored position goes silent.
 *
 * Empty when the track carries no lane, no regions, or none overlapping the
 * clip: an uncomped clip plays only its own media, which the stored-position
 * distribution already keeps. Returns windows in the clip's coordinate system
 * unvalidated — the MIDI split's own validation refuses non-finite or inverted
 * windows rather than silently dropping media a comp region names.
 */
export function collectCompPlayedMediaWindows({
    trackId,
    clip,
    pieceEndBeat,
}: CollectCompPlayedMediaWindowsInput): readonly CompPlayedMediaWindow[] {
    const laneState = takeLaneStore.value;
    const lane = laneState?.lanes.find((candidate) => candidate.trackId === trackId);
    if (!lane || lane.activeCompRegions.length === 0) {
        return [];
    }
    const overlapsClip = lane.activeCompRegions.some(
        (region) => region.startBeat < clip.endBeat && region.endBeat > clip.startBeat
    );
    if (!overlapsClip) {
        return [];
    }

    const windows: CompPlayedMediaWindow[] = [];
    for (const fragment of resolveClipsWithComping(trackId, [clip])) {
        const pieceStart = Math.max(fragment.startBeat, clip.startBeat);
        const clampedPieceEnd = Math.min(fragment.endBeat, pieceEndBeat);
        if (pieceStart >= clampedPieceEnd) {
            continue;
        }
        // A resolved fragment enters its media at `midiOffsetBeats` from the
        // fragment's own start — the pass depth for regions, the clip's own
        // displacement for gaps — so the media window is the fragment's span
        // measured from that offset.
        const midiOffset = fragment.midiOffsetBeats ?? 0;
        windows.push({
            start: midiOffset + (pieceStart - fragment.startBeat),
            end: midiOffset + (clampedPieceEnd - fragment.startBeat),
        });
    }
    return windows;
}
