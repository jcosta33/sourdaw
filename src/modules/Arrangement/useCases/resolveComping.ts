import {
    audioSourceSnapshotAtBeat,
    captureAudioSourceSnapshot,
    partitionAudioSourceTiles,
    audioTakeFragmentSource,
} from '#/utils/audioSourceTime';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';

import { type TempoTimeline } from '../models/TempoTimeline';
import { takeLaneStore, type TakeLaneStoreState } from '../stores/takeLaneStore';
import { type Clip } from '../stores/trackStore';

import { clipMediaOffsetAt } from './clipMediaOffsetAt';
import { liveTempoTimeline } from './liveTempoTimeline';
import { resolveTakeMedia } from './resolveTakeMedia';
import { withMediaOffsetBeats } from './withMediaOffsetBeats';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    return resolveCompingProgramme(trackId, clips, takeLaneStore.value, liveTempoTimeline);
}

/** Private value projection used while materializing a prefix's source owners. */
export function resolveCompingProgramme(
    trackId: string,
    clips: Clip[],
    laneState: TakeLaneStoreState | null,
    timeline: TempoTimeline
): ResolvedClip[] {
    if (!laneState) {
        return clips.map((context) => ({
            ...context,
            regionStartBeat: context.startBeat,
            regionEndBeat: context.endBeat,
            // The pass count measures from the loop anchor, not the current
            // placement: a start trim must not re-roll which passes sound
            // (#4988). Unanchored clips anchor at their current start, which is
            // exactly the pre-anchor reading — and a stale anchor from a past
            // enable is inert while the loop is off.
            sourceStartBeat: resolveLoopAnchoredStartBeat({
                startBeat: context.startBeat,
                loopOriginBeat: context.loopOriginBeat,
                loopEnabled: context.loopEnabled ?? false,
            }),
        }));
    }

    const lane = laneState.lanes.find((length) => length.trackId === trackId);
    if (!lane || (lane.activeCompRegions.length === 0 && !lane.baseGapAudioSources?.length)) {
        return clips.map((context) => ({
            ...context,
            regionStartBeat: context.startBeat,
            regionEndBeat: context.endBeat,
            sourceStartBeat: resolveLoopAnchoredStartBeat({
                startBeat: context.startBeat,
                loopOriginBeat: context.loopOriginBeat,
                loopEnabled: context.loopEnabled ?? false,
            }),
        }));
    }

    const resolved: ResolvedClip[] = [];

    for (const region of lane.activeCompRegions) {
        const take = lane.takes.find((time) => time.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((context) => context.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const media = resolveTakeMedia(take, sourceClip, timeline);
        const overlapStart = Math.max(region.startBeat, media.earliestBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat, media.latestBeatAt?.(overlapStart) ?? Infinity);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        // A comped take fragment's media basis is the take's own: `offsetAt`
        // names what sounds at the region head in take coordinates, so the
        // offset carried below enters that basis at relative 0 and the source
        // clip's loop anchor has no meaning in it — the take's offset never
        // accumulated the anchor's trim advance. Carried through, the
        // loop-window readers derive advance = fragmentStart − anchor from the
        // fragment and pull the read off the comped material onto an earlier
        // pass's (#5198: a region one loop past the anchor read pass 1 at
        // buffer 0 instead of pass 3 at buffer 4). The anchor is therefore
        // stripped and the fragment reads the pre-anchor law — window opening
        // at its own offset, exactly the placed media it read before anchoring
        // existed. Gap fragments below keep the anchor: their offset advances
        // with the same beat as the window, so the source's region law holds
        // there unchanged.
        const takeFragment = withMediaOffsetBeats(sourceClip, media.offsetAt(overlapStart));
        const { loopOriginBeat: _sourceLoopOrigin, ...takeFragmentBasis } = takeFragment;
        const audioSource =
            sourceClip.type === 'audio'
                ? region.audioSource && take.passAnchorSeconds === undefined
                    ? audioSourceSnapshotAtBeat(
                          region.audioSource,
                          overlapStart,
                          sourceClip.stretchMode && sourceClip.stretchMode !== 'off'
                              ? boundStretchRatio(sourceClip.stretchRatio ?? 1)
                              : 1,
                          sourceClip.loopEnabled ?? false,
                          timeline.secondsAtBeat
                      )
                    : audioTakeFragmentSource(
                          media.offsetSecondsAt?.(overlapStart) ??
                              media.offsetAt(overlapStart) * (60 / timeline.tempoAtBeat(overlapStart)),
                          overlapStart
                      )
                : null;
        resolved.push({
            ...takeFragmentBasis,
            ...audioSource,
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: media.sourceStartBeat,
        });
    }

    // §79.2 — setCompRegion.ts is the only writer and already sorts on
    // insert, so activeCompRegions is always already sorted. Use the
    // array directly instead of allocating a fresh \`[...x].sort(...)\`
    // copy on every comping resolution call.
    const sortedRegions = lane.activeCompRegions;

    for (const clip of clips) {
        const gaps: { start: number; end: number }[] = [];
        let cursor = clip.startBeat;

        for (const region of sortedRegions) {
            if (region.endBeat <= clip.startBeat || region.startBeat >= clip.endBeat) {
                continue;
            }
            const regionStart = Math.max(region.startBeat, clip.startBeat);
            if (cursor < regionStart) {
                gaps.push({ start: cursor, end: regionStart });
            }
            cursor = Math.max(cursor, Math.min(region.endBeat, clip.endBeat));
        }
        if (cursor < clip.endBeat) {
            gaps.push({ start: cursor, end: clip.endBeat });
        }

        for (const gap of gaps) {
            const windows = partitionAudioSourceTiles(
                clip.id,
                gap.start,
                gap.end,
                clip.type === 'audio' ? (lane.baseGapAudioSources ?? []) : []
            );
            for (const window of windows) {
                resolved.push(resolveCompBaseGapWindow(clip, window, timeline));
            }
        }
    }

    return resolved.sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
}

/** The actual base-gap window producer, also used to authenticate support conversions. */
export function resolveCompBaseGapWindow(
    clip: Clip,
    window: {
        readonly startBeat: number;
        readonly endBeat: number;
        readonly audioSource?: import('#/utils/audioSourceTime').AudioSourceSnapshot;
    },
    timeline: TempoTimeline
): ResolvedClip {
    const rate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const snapshot =
        window.audioSource ??
        (clip.type === 'audio' && clip.audioOffsetSeconds !== undefined
            ? captureAudioSourceSnapshot(
                  clip,
                  clip.loopLength ?? clip.endBeat - clip.startBeat,
                  timeline.tempoAtBeat(clip.startBeat)
              )
            : null);
    const source = snapshot
        ? audioSourceSnapshotAtBeat(snapshot, window.startBeat, rate, clip.loopEnabled ?? false, timeline.secondsAtBeat)
        : null;
    return {
        ...withMediaOffsetBeats(clip, clipMediaOffsetAt(clip, window.startBeat, timeline)),
        ...source,
        startBeat: window.startBeat,
        endBeat: window.endBeat,
        regionStartBeat: window.startBeat,
        regionEndBeat: window.endBeat,
        sourceStartBeat: resolveLoopAnchoredStartBeat({
            startBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            loopEnabled: clip.loopEnabled ?? false,
        }),
    };
}
