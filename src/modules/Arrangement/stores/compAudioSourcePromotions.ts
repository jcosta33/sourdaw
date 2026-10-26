import {
    isAudioSourceSnapshot,
    partitionAudioSourceTiles,
    type AudioSourceSnapshot,
    type AudioSourceTile,
} from '#/utils/audioSourceTime';
import {
    type CompAudioSourceInputProof,
    type CompAudioSourceOwnerSnapshot,
    type CompAudioSourcePromotionSnapshot,
} from '#/utils/handlerContract';
import { isRecord, valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type TakeLane } from '../models/TakeLane';
import {
    compAudioSourceInputsMatch,
    compAudioSourceOwnerExists,
    isCompAudioSourceInputProof,
    type CompAudioSourceInputContext,
} from './compAudioSourceInputs';

/** Execution-local owning-producer proof. Never accepted from AppAction/session fields. */
export type CompAudioSourceAuthorization = {
    readonly owner: CompAudioSourceOwnerSnapshot;
    readonly source: AudioSourceSnapshot;
    readonly sourceInputs: CompAudioSourceInputProof;
    readonly operation: 'promote' | 'demote' | 'preserve';
};

function ownerIdentity(owner: CompAudioSourceOwnerSnapshot) {
    const { audioSource: _source, ...identity } = owner;
    return identity;
}

function supportAuthorizationMatches(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    source: AudioSourceSnapshot,
    context: CompAudioSourceInputContext | undefined,
    authorizations: readonly CompAudioSourceAuthorization[],
    operation: 'promote' | 'demote'
): boolean {
    return (
        context !== undefined &&
        authorizations.some(
            (authorization) =>
                authorization.operation === operation &&
                valuesEqual(ownerIdentity(authorization.owner), ownerIdentity(owner)) &&
                valuesEqual(authorization.source, source) &&
                compAudioSourceOwnerExists(lane, owner, authorization.sourceInputs, context) &&
                compAudioSourceInputsMatch(lane, owner, authorization.sourceInputs, context)
        )
    );
}

function retainedTakeSourcesMatch(
    lane: TakeLane,
    owner: CompAudioSourceOwnerSnapshot,
    source: AudioSourceSnapshot,
    patch: SourcePatch
): boolean {
    if (owner.kind !== 'take') {
        return true;
    }
    return lane.activeCompRegions
        .filter((region) => region.takeId === owner.takeId && overlaps(region, owner) && !contains(patch, region))
        .every(
            (region) =>
                valuesEqual(region.audioSource, source) ||
                valuesEqual(region, ownerRegion({ ...owner, audioSource: undefined }))
        );
}

type SourcePatch = {
    readonly startBeat: number;
    readonly endBeat: number;
    readonly expected: readonly CompRegion[];
    readonly audioSourcePromotions?: readonly CompAudioSourcePromotionSnapshot[];
    readonly baseGapAudioSourceFieldPresence?: { readonly expected: boolean; readonly replacement: boolean };
};

type Interval = { readonly startBeat: number; readonly endBeat: number };
const overlaps = (a: Interval, b: Interval) => a.startBeat < b.endBeat && b.startBeat < a.endBeat;
const contains = (a: Interval, b: Interval) => a.startBeat <= b.startBeat && b.endBeat <= a.endBeat;

function ownerRegion(owner: CompAudioSourceOwnerSnapshot): CompRegion | null {
    if (owner.kind !== 'take') {
        return null;
    }
    const region: CompRegion = {
        takeId: owner.takeId,
        startBeat: owner.startBeat,
        endBeat: owner.endBeat,
    };
    if (owner.audioSource !== undefined) {
        region.audioSource = owner.audioSource;
    }
    return region;
}

function isOwner(value: unknown): value is CompAudioSourceOwnerSnapshot {
    if (
        !isRecord(value) ||
        typeof value.startBeat !== 'number' ||
        !Number.isFinite(value.startBeat) ||
        value.startBeat < 0 ||
        typeof value.endBeat !== 'number' ||
        !Number.isFinite(value.endBeat) ||
        value.endBeat <= value.startBeat ||
        (Object.hasOwn(value, 'audioSource') && !isAudioSourceSnapshot(value.audioSource))
    ) {
        return false;
    }
    let idKey: 'takeId' | 'clipId' | null = null;
    if (value.kind === 'take') {
        idKey = 'takeId';
    } else if (value.kind === 'base') {
        idKey = 'clipId';
    }
    const id = idKey === null ? null : value[idKey];
    return (
        idKey !== null &&
        typeof id === 'string' &&
        id.length > 0 &&
        Object.keys(value).every((key) => ['kind', idKey, 'startBeat', 'endBeat', 'audioSource'].includes(key))
    );
}

export function isValidCompAudioSourcePromotions(
    value: unknown,
    interval: Interval & { readonly takeIds?: ReadonlySet<string>; readonly baseGapExposed?: boolean }
): value is readonly CompAudioSourcePromotionSnapshot[] {
    if (!Array.isArray(value)) {
        return false;
    }
    return value.every((delta, index) => {
        if (
            !isRecord(delta) ||
            Object.keys(delta).length !== 3 ||
            !isCompAudioSourceInputProof(delta.sourceInputs) ||
            !isOwner(delta.expected) ||
            !isOwner(delta.replacement)
        ) {
            return false;
        }
        const { expected, replacement } = delta;
        if (
            !valuesEqual({ ...expected, audioSource: undefined }, { ...replacement, audioSource: undefined }) ||
            !overlaps(expected, interval) ||
            (expected.kind === 'take' && interval.takeIds !== undefined && !interval.takeIds.has(expected.takeId)) ||
            (expected.kind === 'base' && interval.baseGapExposed === false) ||
            delta.sourceInputs.startBeat > expected.startBeat ||
            delta.sourceInputs.endBeat < expected.endBeat ||
            (!expected.audioSource && !replacement.audioSource) ||
            (expected.audioSource &&
                replacement.audioSource &&
                !valuesEqual(expected.audioSource, replacement.audioSource))
        ) {
            return false;
        }
        return value
            .slice(0, index)
            .every(
                (previous: unknown) =>
                    !isRecord(previous) ||
                    !isOwner(previous.expected) ||
                    !valuesEqual(
                        { ...previous.expected, startBeat: 0, endBeat: 0, audioSource: undefined },
                        { ...expected, startBeat: 0, endBeat: 0, audioSource: undefined }
                    ) ||
                    !overlaps(previous.expected, expected)
            );
    });
}

function coalesce(regions: readonly CompRegion[]): CompRegion[] {
    const result: CompRegion[] = [];
    for (const region of regions) {
        const previous = result.at(-1);
        if (
            previous &&
            previous.endBeat === region.startBeat &&
            previous.takeId === region.takeId &&
            valuesEqual(previous.audioSource, region.audioSource)
        ) {
            result[result.length - 1] = { ...previous, endBeat: region.endBeat };
        } else {
            result.push(region);
        }
    }
    return result;
}

/** Original absence is an exact owner, never a wildcard for a peer's stripped fragment. */
export function compSelectionMatchesSources(
    lane: TakeLane,
    current: readonly CompRegion[],
    patch: SourcePatch,
    context?: CompAudioSourceInputContext
): boolean {
    const expected: CompRegion[] = [];
    for (const span of patch.expected) {
        const cuts = new Set([span.startBeat, span.endBeat]);
        const promotions = (patch.audioSourcePromotions ?? []).filter(
            (delta) =>
                delta.expected.kind === 'take' &&
                delta.expected.takeId === span.takeId &&
                overlaps(delta.expected, span)
        );
        for (const delta of promotions) {
            if (span.startBeat < delta.expected.startBeat && delta.expected.startBeat < span.endBeat) {
                cuts.add(delta.expected.startBeat);
            }
            if (span.startBeat < delta.expected.endBeat && delta.expected.endBeat < span.endBeat) {
                cuts.add(delta.expected.endBeat);
            }
        }
        const edges = [...cuts].sort((a, b) => a - b);
        for (let index = 0; index < edges.length - 1; index++) {
            const part = { ...span, startBeat: edges[index]!, endBeat: edges[index + 1]! };
            const delta = promotions.find(
                (candidate) =>
                    contains(candidate.expected, part) &&
                    candidate.expected.audioSource === undefined &&
                    candidate.replacement.audioSource !== undefined &&
                    span.audioSource === undefined
            );
            if (!delta) {
                expected.push(part);
                continue;
            }
            const live = lane.activeCompRegions.find(
                (region) => region.takeId === span.takeId && contains(region, part)
            );
            if (
                live &&
                valuesEqual(live, ownerRegion(delta.expected)) &&
                compAudioSourceInputsMatch(lane, delta.expected, delta.sourceInputs, context)
            ) {
                expected.push(part);
            } else if (
                live &&
                contains(delta.expected, live) &&
                valuesEqual(live.audioSource, delta.replacement.audioSource)
            ) {
                expected.push({ ...part, audioSource: delta.replacement.audioSource });
            } else {
                return false;
            }
        }
    }
    return valuesEqual(coalesce(expected), current);
}

function gaps(regions: readonly CompRegion[], interval: Interval): Interval[] {
    const result: Interval[] = [];
    let cursor = interval.startBeat;
    for (const region of regions) {
        if (!overlaps(region, interval)) {
            continue;
        }
        if (cursor < region.startBeat) {
            result.push({ startBeat: cursor, endBeat: Math.min(region.startBeat, interval.endBeat) });
        }
        cursor = Math.max(cursor, Math.min(region.endBeat, interval.endBeat));
    }
    if (cursor < interval.endBeat) {
        result.push({ startBeat: cursor, endBeat: interval.endBeat });
    }
    return result;
}

function coveredBySource(
    tiles: readonly AudioSourceTile[],
    clipId: string,
    interval: Interval,
    source: AudioSourceSnapshot
): boolean {
    return partitionAudioSourceTiles(clipId, interval.startBeat, interval.endBeat, tiles).every((part) =>
        valuesEqual(part.audioSource, source)
    );
}

function takeOwnerIsComplete(
    regions: readonly CompRegion[],
    owner: CompAudioSourceOwnerSnapshot,
    patch: SourcePatch
): boolean {
    if (owner.kind !== 'take') {
        return false;
    }
    let cursor = owner.startBeat;
    for (const region of regions.filter((region) => overlaps(region, owner))) {
        if (
            region.startBeat !== cursor ||
            region.endBeat > owner.endBeat ||
            region.takeId !== owner.takeId ||
            !(
                valuesEqual(region.audioSource, owner.audioSource) ||
                (region.audioSource === undefined && contains(patch, region))
            )
        ) {
            return false;
        }
        cursor = region.endBeat;
    }
    return cursor === owner.endBeat;
}

/** Apply only saved source-owner deltas; independent selections and tiles remain live.
 * Demotion to legacy absence additionally requires the original source inputs.
 * A peer tempo/depth promotion keeps saved R, never recaptures it under a new map. */
export function applyCompAudioSourcePromotions(
    before: TakeLane,
    nextRegions: readonly CompRegion[],
    patch: SourcePatch,
    context?: CompAudioSourceInputContext,
    authorizations: readonly CompAudioSourceAuthorization[] = []
): TakeLane | null {
    let regions = [...nextRegions];
    let tiles = before.baseGapAudioSources === undefined ? undefined : [...before.baseGapAudioSources];
    for (const delta of patch.audioSourcePromotions ?? []) {
        const owner = delta.expected;
        if (context && !compAudioSourceOwnerExists(before, owner, delta.sourceInputs, context)) {
            return null;
        }
        const inputsUnchanged = compAudioSourceInputsMatch(before, owner, delta.sourceInputs, context);
        const source = owner.audioSource ?? delta.replacement.audioSource;
        if (!source || !retainedTakeSourcesMatch(before, owner, source, patch)) {
            return null;
        }
        const canPromote = supportAuthorizationMatches(before, owner, source, context, authorizations, 'promote');
        const canDemote = supportAuthorizationMatches(before, owner, source, context, authorizations, 'demote');
        if (owner.kind === 'take') {
            if (
                delta.replacement.audioSource === undefined &&
                inputsUnchanged &&
                canDemote &&
                takeOwnerIsComplete(regions, owner, patch)
            ) {
                const original = ownerRegion(delta.replacement);
                if (!original) {
                    return null;
                }
                regions = [...regions.filter((region) => !overlaps(region, owner)), original].sort(
                    (a, b) => a.startBeat - b.startBeat
                );
                continue;
            }
            const originalIsLive = before.activeCompRegions.some((region) => valuesEqual(region, ownerRegion(owner)));
            if (
                delta.replacement.audioSource !== undefined &&
                originalIsLive &&
                regions.some(
                    (region) =>
                        region.takeId === owner.takeId &&
                        contains(owner, region) &&
                        !contains(patch, region) &&
                        valuesEqual(region.audioSource, owner.audioSource)
                ) &&
                !canPromote
            ) {
                return null;
            }
            regions = regions.map((region) => {
                if (region.takeId !== owner.takeId || !contains(owner, region)) {
                    return region;
                }
                if (
                    delta.replacement.audioSource !== undefined &&
                    originalIsLive &&
                    valuesEqual(region.audioSource, owner.audioSource)
                ) {
                    return { ...region, audioSource: delta.replacement.audioSource };
                }
                if (
                    delta.replacement.audioSource === undefined &&
                    contains(patch, region) &&
                    region.audioSource === undefined
                ) {
                    return { ...region, audioSource: source };
                }
                return region;
            });
            continue;
        }
        const oldTiles = before.baseGapAudioSources ?? [];
        const ownTiles = oldTiles.filter((tile) => tile.clipId === owner.clipId && overlaps(tile, owner));
        if (ownTiles.some((tile) => !contains(patch, tile) && !valuesEqual(tile.audioSource, source))) {
            return null;
        }
        const implicitOriginal =
            owner.audioSource === undefined &&
            !before.activeCompRegions.some((region) => overlaps(region, owner)) &&
            ownTiles.length === 0;
        const originallyMasked =
            owner.audioSource === undefined &&
            gaps(before.activeCompRegions, owner).length === 0 &&
            contains(patch, owner) &&
            ownTiles.length === 0;
        const query = {
            startBeat: Math.max(owner.startBeat, patch.startBeat),
            endBeat: Math.min(owner.endBeat, patch.endBeat),
        };
        if (ownTiles.some((tile) => overlaps(tile, query) && !valuesEqual(tile.audioSource, source))) {
            return null;
        }
        if (
            !implicitOriginal &&
            !originallyMasked &&
            gaps(before.activeCompRegions, query).some((gap) => !coveredBySource(oldTiles, owner.clipId, gap, source))
        ) {
            return null;
        }
        const newGaps = gaps(regions, owner);
        const hasUnknownSource = ownTiles.some((tile) => !valuesEqual(tile.audioSource, source));
        const complete =
            newGaps.length === 1 &&
            valuesEqual(newGaps[0], { startBeat: owner.startBeat, endBeat: owner.endBeat }) &&
            !hasUnknownSource &&
            partitionAudioSourceTiles(owner.clipId, owner.startBeat, owner.endBeat, oldTiles).every(
                (part) =>
                    valuesEqual(part.audioSource, source) || (part.audioSource === undefined && contains(patch, part))
            );
        const retained: AudioSourceTile[] = [];
        for (const tile of tiles ?? []) {
            if (tile.clipId !== owner.clipId || !overlaps(tile, owner) || !valuesEqual(tile.audioSource, source)) {
                retained.push(tile);
                continue;
            }
            if (tile.startBeat < owner.startBeat) {
                retained.push({ ...tile, endBeat: owner.startBeat });
            }
            if (tile.endBeat > owner.endBeat) {
                retained.push({ ...tile, startBeat: owner.endBeat });
            }
        }
        if (!(delta.replacement.audioSource === undefined && inputsUnchanged && canDemote && complete)) {
            for (const gap of newGaps) {
                for (const part of partitionAudioSourceTiles(owner.clipId, gap.startBeat, gap.endBeat, retained)) {
                    if (
                        part.audioSource ||
                        !(
                            implicitOriginal ||
                            originallyMasked ||
                            contains(patch, part) ||
                            coveredBySource(oldTiles, owner.clipId, part, source)
                        )
                    ) {
                        continue;
                    }
                    if (
                        !contains(patch, part) &&
                        !coveredBySource(oldTiles, owner.clipId, part, source) &&
                        !canPromote
                    ) {
                        return null;
                    }
                    retained.push({
                        clipId: owner.clipId,
                        startBeat: part.startBeat,
                        endBeat: part.endBeat,
                        audioSource: source,
                    });
                }
            }
        }
        retained.sort((a, b) => a.clipId.localeCompare(b.clipId) || a.startBeat - b.startBeat);
        tiles = retained;
    }
    const result = { ...before, activeCompRegions: regions };
    if ((patch.audioSourcePromotions ?? []).some((delta) => delta.expected.kind === 'base')) {
        if (
            tiles?.length ||
            (patch.baseGapAudioSourceFieldPresence?.replacement ?? before.baseGapAudioSources !== undefined)
        ) {
            result.baseGapAudioSources = tiles ?? [];
        } else {
            delete result.baseGapAudioSources;
        }
    }
    return result;
}
