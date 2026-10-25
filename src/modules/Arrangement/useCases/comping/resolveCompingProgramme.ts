import { audioSourceSnapshotAtBeat, partitionAudioSourceTiles, audioTakeFragmentSource } from '#/utils/audioSourceTime';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';
import { compBaseGapWindows } from '#/utils/compBaseGapWindows';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type ResolvedClip } from '../../models/ResolvedClip';
import { type Clip } from '../../models/Track';
import { type TakeLaneStoreState } from '../../stores/takeLaneStore';

import { resolveTakeMedia } from '../resolveTakeMedia';
import { withMediaOffsetBeats } from '../withMediaOffsetBeats';
import { resolveCompBaseGapWindow } from './resolveCompBaseGapWindow';

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
        let audioSource: ReturnType<typeof audioSourceSnapshotAtBeat> | ReturnType<typeof audioTakeFragmentSource> =
            null;
        if (sourceClip.type === 'audio') {
            if (region.audioSource && take.passAnchorSeconds === undefined) {
                let rate = 1;
                if (sourceClip.stretchMode && sourceClip.stretchMode !== 'off') {
                    rate = boundStretchRatio(sourceClip.stretchRatio ?? 1);
                }
                audioSource = audioSourceSnapshotAtBeat(
                    region.audioSource,
                    overlapStart,
                    rate,
                    sourceClip.loopEnabled ?? false,
                    timeline.secondsAtBeat
                );
            } else {
                audioSource = audioTakeFragmentSource(
                    media.offsetSecondsAt?.(overlapStart) ??
                        media.offsetAt(overlapStart) * (60 / timeline.tempoAtBeat(overlapStart)),
                    overlapStart
                );
            }
        }
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
        for (const gap of compBaseGapWindows(clip, sortedRegions)) {
            const windows = partitionAudioSourceTiles(
                clip.id,
                gap.startBeat,
                gap.endBeat,
                clip.type === 'audio' ? (lane.baseGapAudioSources ?? []) : []
            );
            for (const window of windows) {
                resolved.push(resolveCompBaseGapWindow(clip, window, timeline));
            }
        }
    }

    return resolved.sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
}
