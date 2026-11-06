import { audioSourceSnapshotAtBeat, type AudioSourceTile } from '#/utils/audioSourceTime';
import { canonicalJson } from '#/utils/canonicalDigest';
import { boundStretchRatio } from '#/utils/stretchRatioBound';
import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type TakeLane } from '../../models/TakeLane';
import { collectLiveClipIds } from '../../services/collectLiveClipIds';
import { findClipById } from '../../services/findClipById';
import {
    captureBaseGapAudioSources,
    reconcileBaseGapAudioSourceDelta,
    type OptionalAudioSourceTiles,
} from '../../stores/baseGapAudioSourceDelta';
import { getTrackStoreState } from '../getTrackStoreState';
import { liveTempoTimeline } from '../liveTempoTimeline';

import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

function sourceMatchesAtBeat(
    tile: AudioSourceTile,
    region: CompRegion,
    beat: number,
    tracks: NonNullable<ReturnType<typeof getTrackStoreState>>['tracks']
): boolean {
    if (!region.audioSource) {
        return false;
    }
    const clip = findClipById({ clipId: tile.clipId, tracks })?.clip;
    if (!clip || clip.type !== 'audio') {
        return false;
    }
    const rate = clip.stretchMode && clip.stretchMode !== 'off' ? boundStretchRatio(clip.stretchRatio ?? 1) : 1;
    const loopEnabled = clip.loopEnabled ?? false;
    const expected = audioSourceSnapshotAtBeat(
        tile.audioSource,
        beat,
        rate,
        loopEnabled,
        liveTempoTimeline.secondsAtBeat
    );
    const actual = audioSourceSnapshotAtBeat(
        region.audioSource,
        beat,
        rate,
        loopEnabled,
        liveTempoTimeline.secondsAtBeat
    );
    return (
        expected !== null &&
        actual !== null &&
        (loopEnabled ? valuesEqual(actual, expected) : actual.audioOffsetSeconds === expected.audioOffsetSeconds)
    );
}

function sourceIsCovered(
    tile: AudioSourceTile,
    liveTiles: readonly AudioSourceTile[],
    lane: TakeLane,
    tracks: NonNullable<ReturnType<typeof getTrackStoreState>>['tracks']
): boolean {
    const overlapping = liveTiles.filter(
        (candidate) =>
            candidate.clipId === tile.clipId && candidate.startBeat < tile.endBeat && tile.startBeat < candidate.endBeat
    );
    if (overlapping.some((candidate) => !valuesEqual(candidate.audioSource, tile.audioSource))) {
        return false;
    }
    let cursor = tile.startBeat;
    while (cursor < tile.endBeat) {
        const base = overlapping.find((candidate) => candidate.startBeat <= cursor && cursor < candidate.endBeat);
        if (base) {
            cursor = Math.min(base.endBeat, tile.endBeat);
            continue;
        }
        const region = lane.activeCompRegions.find(
            (candidate) =>
                candidate.startBeat <= cursor &&
                cursor < candidate.endBeat &&
                sourceMatchesAtBeat(tile, candidate, cursor, tracks) &&
                lane.takes.some((take) => take.id === candidate.takeId && take.clipId === tile.clipId)
        );
        if (!region) {
            return false;
        }
        cursor = Math.min(region.endBeat, tile.endBeat);
    }
    return true;
}

function restoreBaseGaps(
    from: readonly AudioSourceTile[] | undefined,
    to: readonly AudioSourceTile[] | undefined,
    liveClips: Set<string>,
    liveTiles: readonly AudioSourceTile[],
    lane: TakeLane,
    tracks: NonNullable<ReturnType<typeof getTrackStoreState>>['tracks'],
    replacement: OptionalAudioSourceTiles
): OptionalAudioSourceTiles | null {
    // A later comp choice can divide a producer-owned gap into exact source
    // fragments and source-bearing regions. Admit that division, but never an
    // uncovered or changed physical source on a clip that is still live.
    if (!from) {
        return null;
    }
    const fromKeys = new Set(from.map(canonicalJson));
    const toKeys = new Set((to ?? []).map(canonicalJson));
    const removed = from.filter((tile) => !toKeys.has(canonicalJson(tile)));
    if (removed.length === 0 || (to ?? []).some((tile) => !fromKeys.has(canonicalJson(tile)))) {
        return null;
    }
    if (removed.some((tile) => liveClips.has(tile.clipId) && !sourceIsCovered(tile, liveTiles, lane, tracks))) {
        return null;
    }
    const removedKeys = new Set(removed.map(canonicalJson));
    const result = liveTiles.filter((tile) => liveClips.has(tile.clipId) && !removedKeys.has(canonicalJson(tile)));
    return result.length === 0 && !replacement.present ? { present: false } : { present: true, value: result };
}

export function reconcileTransitionBaseGaps(
    lane: TakeLane,
    transition: TakeReKeyLaneTransition,
    direction: 'apply' | 'restore'
): OptionalAudioSourceTiles | null {
    const from = direction === 'apply' ? transition.baseGapAudioSourcesBefore : transition.baseGapAudioSourcesAfter;
    const to = direction === 'apply' ? transition.baseGapAudioSourcesAfter : transition.baseGapAudioSourcesBefore;
    const current = captureBaseGapAudioSources(lane);
    const expected: OptionalAudioSourceTiles = from === undefined ? { present: false } : { present: true, value: from };
    const replacement: OptionalAudioSourceTiles = to === undefined ? { present: false } : { present: true, value: to };
    const exact = reconcileBaseGapAudioSourceDelta(current, expected, replacement);
    if (exact) {
        return exact;
    }

    if (direction === 'apply' && ((from?.length ?? 0) > 0 || !to?.length)) {
        return null;
    }
    const trackState = getTrackStoreState();
    if (!trackState) {
        return null;
    }
    const tracks = trackState.tracks;
    const liveClips = collectLiveClipIds(tracks);
    const liveTiles = current.present ? current.value : [];
    if (direction === 'apply') {
        // An initially empty lane can acquire peer comp subdivisions before
        // redo. Keep their exact physical source and add only the new clip's
        // non-overlapping tiles; a changed or uncovered source still refuses.
        const additions = to ?? [];
        const result = [...liveTiles];
        for (const tile of additions) {
            const overlaps = result.some(
                (candidate) =>
                    candidate.clipId === tile.clipId &&
                    candidate.startBeat < tile.endBeat &&
                    tile.startBeat < candidate.endBeat
            );
            if (overlaps) {
                if (!sourceIsCovered(tile, liveTiles, lane, tracks)) {
                    return null;
                }
                continue;
            }
            result.push(structuredClone(tile));
        }
        result.sort((a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat);
        return { present: true, value: result };
    }

    return restoreBaseGaps(from, to, liveClips, liveTiles, lane, tracks, replacement);
}
