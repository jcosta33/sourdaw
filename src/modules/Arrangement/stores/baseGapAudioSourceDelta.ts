import { type AudioSourceTile } from '#/utils/audioSourceTime';
import { canonicalJson } from '#/utils/canonicalDigest';
import { valuesEqual } from '#/utils/structuralEquality';

import { type TakeLane } from '../models/TakeLane';

export type OptionalAudioSourceTiles =
    { readonly present: false } | { readonly present: true; readonly value: readonly AudioSourceTile[] };

export function captureBaseGapAudioSources(lane: Pick<TakeLane, 'baseGapAudioSources'>): OptionalAudioSourceTiles {
    return lane.baseGapAudioSources === undefined
        ? { present: false }
        : { present: true, value: structuredClone(lane.baseGapAudioSources) };
}

export function replaceBaseGapAudioSources(lane: TakeLane, value: OptionalAudioSourceTiles): TakeLane {
    const next = { ...lane };
    if (value.present) next.baseGapAudioSources = value.value.map((tile) => structuredClone(tile));
    else delete next.baseGapAudioSources;
    return next;
}

/** Reconcile only changed source values. Copied tiles grant no ownership of
 * later peer edits, deletions, additions, or the presence of their array. */
export function reconcileBaseGapAudioSourceDelta(
    current: OptionalAudioSourceTiles,
    expected: OptionalAudioSourceTiles,
    replacement: OptionalAudioSourceTiles
): OptionalAudioSourceTiles | null {
    if (valuesEqual(expected, replacement)) return current;
    const from = expected.present ? expected.value : [];
    const to = replacement.present ? replacement.value : [];
    const live = current.present ? current.value : [];
    const fromKeys = new Set(from.map(canonicalJson));
    const toKeys = new Set(to.map(canonicalJson));
    const removed = from.filter((tile) => !toKeys.has(canonicalJson(tile)));
    const additions = to.filter((tile) => !fromKeys.has(canonicalJson(tile)));
    if (removed.some((tile) => !live.some((candidate) => valuesEqual(candidate, tile)))) return null;
    if (removed.length === 0 && additions.length === 0) return valuesEqual(current, expected) ? replacement : current;
    const removedKeys = new Set(removed.map(canonicalJson));
    const result = live.filter((tile) => !removedKeys.has(canonicalJson(tile)));
    for (const tile of additions) {
        if (
            result.some(
                (candidate) =>
                    candidate.clipId === tile.clipId &&
                    candidate.startBeat < tile.endBeat &&
                    tile.startBeat < candidate.endBeat
            )
        )
            return null;
        result.push(structuredClone(tile));
    }
    result.sort((a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat);
    return result.length === 0 && !replacement.present ? { present: false } : { present: true, value: result };
}
