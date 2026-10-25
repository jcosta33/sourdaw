import { type CompAudioSourceOwnerSnapshot, type CompAudioSourcePromotionSnapshot } from '#/utils/handlerContract';

import { type CompRegion, type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Clip } from '../../models/Track';
import { captureCompAudioSourceInputProof, type CompAudioSourceInputContext } from '../../stores/compAudioSourceInputs';
import {
    applyTakeLaneCompRegionPatch,
    type TakeLaneCompRegionPatch,
    type TakeLaneStoreValue,
} from '../../stores/takeLaneWriteJournal';
import { resolveCompingProgramme, type ResolvedClip } from '../resolveComping';
import { captureResolvedAudioSourceSnapshot as snapshot } from './captureResolvedAudioSourceSnapshot';
import { captureCompAudioSourceAuthorizations } from './captureCompAudioSourceAuthorizations';

function selectedSource(
    region: CompRegion,
    lane: TakeLane,
    programme: readonly ResolvedClip[],
    timeline: TempoTimeline
) {
    const take = lane.takes.find((candidate) => candidate.id === region.takeId);
    // A placed pass owns a physical origin and eligibility law; a region
    // programme must never become another clock when its playback rate changes.
    if (take?.passAnchorSeconds !== undefined) return null;
    if (region.audioSource) return region.audioSource;
    const clip = programme.find(
        (candidate) =>
            candidate.type === 'audio' &&
            candidate.id === take?.clipId &&
            candidate.startBeat >= region.startBeat &&
            candidate.endBeat <= region.endBeat
    );
    return clip ? snapshot(clip, timeline) : null;
}
function isBase(clip: ResolvedClip, regions: readonly CompRegion[]): boolean {
    return (
        clip.type === 'audio' &&
        !regions.some((region) => region.startBeat < clip.endBeat && region.endBeat > clip.startBeat)
    );
}
function intersects(a: { startBeat: number; endBeat: number }, b: { startBeat: number; endBeat: number }): boolean {
    return a.startBeat < b.endBeat && b.startBeat < a.endBeat;
}
function baseOwner(clip: ResolvedClip, lane: TakeLane): CompAudioSourceOwnerSnapshot {
    const tile = lane.baseGapAudioSources?.find(
        (candidate) =>
            candidate.clipId === clip.id && candidate.startBeat <= clip.startBeat && candidate.endBeat >= clip.endBeat
    );
    return {
        kind: 'base',
        clipId: clip.id,
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        ...(tile ? { audioSource: tile.audioSource } : {}),
    };
}

/** Capture actual old-law owners once; retained pieces inherit the same value and grid. */
export function prepareCompAudioSourcePatch(
    state: TakeLaneStoreValue,
    patch: TakeLaneCompRegionPatch,
    clips: Clip[],
    timeline: TempoTimeline,
    context: CompAudioSourceInputContext
): TakeLaneCompRegionPatch | null {
    const lane = state.lanes.find((candidate) => candidate.id === patch.laneId && candidate.trackId === patch.trackId);
    if (!lane) return null;
    // Choosing an already selected interval is still a no-op, including a
    // canonical region whose entry is different from a freshly drawn region.
    if (
        patch.expected.length === 1 &&
        patch.replacement.length === 1 &&
        patch.expected[0]!.takeId === patch.replacement[0]!.takeId &&
        patch.expected[0]!.startBeat === patch.startBeat &&
        patch.expected[0]!.endBeat === patch.endBeat
    )
        return { ...patch, replacement: structuredClone(patch.expected) };
    if (!clips.some((clip) => clip.type === 'audio')) return patch;
    const before = resolveCompingProgramme(patch.trackId, clips, state, timeline);
    const rawAfter = applyTakeLaneCompRegionPatch(state, patch);
    if (!rawAfter) return null;
    const afterLane = rawAfter.lanes.find((candidate) => candidate.id === lane.id);
    if (!afterLane) return null;
    const after = resolveCompingProgramme(patch.trackId, clips, rawAfter, timeline);
    const replacement = patch.replacement.map((region) => {
        const source = selectedSource(region, afterLane, after, timeline);
        return source ? { ...region, audioSource: source } : region;
    });
    const promotions: Omit<CompAudioSourcePromotionSnapshot, 'sourceInputs'>[] = [];
    for (const region of lane.activeCompRegions) {
        if (region.audioSource || !intersects(region, patch)) continue;
        const source = selectedSource(region, lane, before, timeline);
        if (!source) continue;
        const expected: CompAudioSourceOwnerSnapshot = { kind: 'take', ...region };
        promotions.push({ expected, replacement: { ...expected, audioSource: source } });
    }
    const beforeBase = before.filter((clip) => isBase(clip, lane.activeCompRegions));
    for (const clip of beforeBase) {
        if (!intersects(clip, patch)) continue;
        const expected = baseOwner(clip, lane);
        const source = expected.audioSource ?? snapshot(clip, timeline);
        if (source) promotions.push({ expected, replacement: { ...expected, audioSource: source } });
    }
    // Newly exposed base spans have no prior audible owner. Capture their
    // current base law once, leaving the old adjacent gap owners untouched.
    for (const clip of after.filter(
        (candidate) => isBase(candidate, afterLane.activeCompRegions) && intersects(candidate, patch)
    )) {
        const start = Math.max(clip.startBeat, patch.startBeat);
        const end = Math.min(clip.endBeat, patch.endBeat);
        const previous = beforeBase.filter(
            (candidate) => candidate.id === clip.id && intersects(candidate, { startBeat: start, endBeat: end })
        );
        const source = snapshot(clip, timeline);
        if (!source) continue;
        let cursor = start;
        for (const old of previous) {
            if (cursor < old.startBeat) {
                const expected: CompAudioSourceOwnerSnapshot = {
                    kind: 'base',
                    clipId: clip.id,
                    startBeat: cursor,
                    endBeat: Math.min(old.startBeat, end),
                };
                promotions.push({ expected, replacement: { ...expected, audioSource: source } });
            }
            cursor = Math.max(cursor, Math.min(old.endBeat, end));
        }
        if (cursor < end) {
            const expected: CompAudioSourceOwnerSnapshot = {
                kind: 'base',
                clipId: clip.id,
                startBeat: cursor,
                endBeat: end,
            };
            promotions.push({ expected, replacement: { ...expected, audioSource: source } });
        }
    }
    const authenticated: CompAudioSourcePromotionSnapshot[] = [];
    for (const promotion of promotions) {
        const sourceInputs = captureCompAudioSourceInputProof(lane, promotion.expected, context);
        if (!sourceInputs) return null;
        authenticated.push({ ...promotion, sourceInputs });
    }
    const prepared = {
        ...patch,
        replacement,
        ...(promotions.length === 0 ? {} : { audioSourcePromotions: authenticated }),
    };
    const authorizations = captureCompAudioSourceAuthorizations(state, prepared, clips, timeline, context);
    if (!authorizations) return null;
    const next = applyTakeLaneCompRegionPatch(state, prepared, context, authorizations);
    const nextLane = next?.lanes.find((candidate) => candidate.id === lane.id);
    if (!nextLane) return null;
    if (promotions.some((delta) => delta.expected.kind === 'base')) {
        return {
            ...prepared,
            baseGapAudioSourceFieldPresence: {
                expected: lane.baseGapAudioSources !== undefined,
                replacement: nextLane.baseGapAudioSources !== undefined,
            },
        };
    }
    return prepared;
}
