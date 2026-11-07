import { resolveLoopAnchoredStartBeat } from '#/utils/clipLoopOrigin';
import { resolveTakeMedia } from '../stores/resolveTakeMedia';
import { takeLaneStore } from '../stores/takeLaneStore';
import { type Clip } from '../stores/trackStore';

import { liveTempoTimeline } from './liveTempoTimeline';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
    /** Projection only: the onset pass this fragment may sound. */
    recordingPassId?: string;
};

export function resolveClipsWithComping(trackId: string, clips: Clip[]): ResolvedClip[] {
    const laneState = takeLaneStore.value;
    if (!laneState) {
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

    const lane = laneState.lanes.find((length) => length.trackId === trackId);
    const selectedPass = lane?.takes.find((take) => take.selected && take.recordingPassId !== undefined);
    // Recorded-pass promotion is derived from the guarded selection. Undo and
    // peer changes therefore publish the audible selection atomically too.
    const regions =
        selectedPass && lane?.activeCompRegions.length === 0
            ? [
                  {
                      takeId: selectedPass.id,
                      startBeat: Math.min(
                          selectedPass.startBeat,
                          clips.find((clip) => clip.id === selectedPass.clipId)?.startBeat ?? selectedPass.startBeat
                      ),
                      endBeat: Math.max(
                          selectedPass.endBeat,
                          clips.find((clip) => clip.id === selectedPass.clipId)?.endBeat ?? selectedPass.endBeat
                      ),
                  },
              ]
            : (lane?.activeCompRegions ?? []);
    if (!lane || regions.length === 0) {
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

    for (const region of regions) {
        const take = lane.takes.find((time) => time.id === region.takeId);
        if (!take) {
            continue;
        }

        const sourceClip = clips.find((context) => context.id === take.clipId);
        if (!sourceClip) {
            continue;
        }

        const media = resolveTakeMedia(take, sourceClip, liveTempoTimeline);
        const overlapStart = Math.max(region.startBeat, media.earliestBeat);
        const overlapEnd = Math.min(region.endBeat, sourceClip.endBeat, media.latestBeatAt?.(overlapStart) ?? Infinity);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        resolved.push({
            ...media.clipAt(overlapStart),
            startBeat: overlapStart,
            endBeat: overlapEnd,
            regionStartBeat: overlapStart,
            regionEndBeat: overlapEnd,
            sourceStartBeat: media.sourceStartBeat,
            ...(take.recordingPassId === undefined ? {} : { recordingPassId: take.recordingPassId }),
        });
    }

    // §79.2 — setCompRegion.ts is the only writer and already sorts on
    // insert, so activeCompRegions is always already sorted. Use the
    // array directly instead of allocating a fresh \`[...x].sort(...)\`
    // copy on every comping resolution call.
    const sortedRegions = regions;

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
            resolved.push({
                ...resolveTakeMedia({}, clip, liveTempoTimeline).clipAt(gap.start),
                startBeat: gap.start,
                endBeat: gap.end,
                regionStartBeat: gap.start,
                regionEndBeat: gap.end,
                sourceStartBeat: resolveLoopAnchoredStartBeat({
                    startBeat: clip.startBeat,
                    loopOriginBeat: clip.loopOriginBeat,
                    loopEnabled: clip.loopEnabled ?? false,
                }),
            });
        }
    }

    return resolved.sort((alpha, buffer) => alpha.startBeat - buffer.startBeat);
}
