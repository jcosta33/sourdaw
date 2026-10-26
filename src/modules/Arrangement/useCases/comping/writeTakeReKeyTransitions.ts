import { valuesEqual } from '#/utils/structuralEquality';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { collectLiveClipIds } from '../../services/collectLiveClipIds';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { replaceBaseGapAudioSources } from '../../stores/takeLaneWriteJournal';
import { getTrackStoreState } from '../getTrackStoreState';

import { reconcileTransitionBaseGaps, reconcileTransitionRegions } from './reconcileTakeReKeySources';
import { type TakeReKeyLaneTransition } from './takeReKeyTransition';

export type TakeReKeyWriteDirection = 'apply' | 'restore';

function isModifiedByTransition(take: Take, other: Take): boolean {
    return (
        take.clipId !== other.clipId ||
        take.startBeat !== other.startBeat ||
        take.endBeat !== other.endBeat ||
        take.name !== other.name ||
        take.sourceOffsetBeats !== other.sourceOffsetBeats ||
        take.sourceOffsetSeconds !== other.sourceOffsetSeconds ||
        take.passAnchorSeconds !== other.passAnchorSeconds ||
        take.passDepthSeconds !== other.passDepthSeconds ||
        take.passSourceEndSeconds !== other.passSourceEndSeconds ||
        take.passOriginBeat !== other.passOriginBeat ||
        take.passOriginSourceSeconds !== other.passOriginSourceSeconds
    );
}

/**
 * The takes facet of one lane, reconciled toward the transition's target side.
 *
 * The rule set mirrors `reconcileLane`'s: only the transition's own deltas
 * move. A take the transform removed leaves; a take it added or moved comes
 * back when its clip is live (a take whose clip is gone has no material to
 * resolve against — the liveness rule every take replay follows); a take it
 * re-keyed, split, trimmed, or shifted takes the target side's fields, except
 * `selected` — interaction state the operation never owns, so a live toggle
 * survives either direction. A retained live selection wins over a missing
 * take's captured selection; without one, at most one restored take regains
 * selection. A take identical on both sides (including one
 * the paired retirement removes: it is verbatim in both captures) is never
 * touched here — and when live no longer holds it, it stays absent: its
 * deletion is a write the capture never recorded, the resurrection doctrine
 * `reconcileLane` documents. A take the transition never heard of — a
 * collaborator's write that landed after the capture — survives untouched
 * while its clip survives. A facet keyed to a clip this replay removes cannot
 * survive as an orphan, even when it was authored after the capture.
 *
 * `requireLiveClipIds` answers the liveness question, computing the
 * project-wide clip-id set on first use and caching it for the rest of the
 * write: moving captured takes alone never triggers the scan.
 */
function reconcileTransitionTakes(
    live: readonly Take[],
    fromTakes: readonly Take[],
    toTakes: readonly Take[],
    requireLiveClipIds: () => ReadonlySet<string>
): readonly Take[] {
    const fromIds = new Set(fromTakes.map((take) => take.id));
    const fromById = new Map(fromTakes.map((take) => [take.id, take]));
    const toById = new Map(toTakes.map((take) => [take.id, take]));
    const liveById = new Map(live.map((take) => [take.id, take]));
    const modifiedIds = new Set<string>();
    for (const target of toTakes) {
        const source = fromById.get(target.id);
        if (source && isModifiedByTransition(target, source)) {
            modifiedIds.add(target.id);
        }
    }
    let liveClipIds: ReadonlySet<string> | null = null;
    const targetClipIds = new Set(toTakes.map((take) => take.clipId));
    const removedClipCandidates = new Set(fromTakes.map((take) => take.clipId).filter((id) => !targetClipIds.has(id)));
    let hasSelectedTake = live.some(
        (take) =>
            take.selected &&
            (toById.has(take.id) || !fromIds.has(take.id)) &&
            (!removedClipCandidates.has(take.clipId) || requireLiveClipIds().has(take.clipId))
    );

    const reconciled: Take[] = [];
    for (const target of toTakes) {
        const liveTake = liveById.get(target.id);
        if (!liveTake) {
            // Re-add only takes the transition itself moved — minted across
            // the facets, or re-keyed between them. A take verbatim on both
            // facets and missing from live was deleted by a write the capture
            // never recorded: it stays absent rather than being resurrected.
            if (fromById.has(target.id) && !modifiedIds.has(target.id)) {
                continue;
            }
            if (liveClipIds === null) {
                liveClipIds = requireLiveClipIds();
            }
            if (liveClipIds.has(target.clipId)) {
                const restored = structuredClone(target);
                restored.selected = target.selected && !hasSelectedTake;
                hasSelectedTake = hasSelectedTake || restored.selected;
                reconciled.push(restored);
            }
            continue;
        }
        if (modifiedIds.has(target.id)) {
            reconciled.push({ ...target, selected: liveTake.selected });
            continue;
        }
        reconciled.push(liveTake);
    }
    for (const liveTake of live) {
        if (!fromIds.has(liveTake.id) && !toById.has(liveTake.id)) {
            reconciled.push(liveTake);
        }
    }
    return reconciled.filter(
        (take) => !removedClipCandidates.has(take.clipId) || requireLiveClipIds().has(take.clipId)
    );
}

function takesMatch(left: readonly Take[], right: readonly Take[]): boolean {
    return (
        left.length === right.length &&
        left.every((take, index) => {
            const other = right[index]!;
            return (
                take.id === other.id &&
                take.clipId === other.clipId &&
                take.name === other.name &&
                take.startBeat === other.startBeat &&
                take.endBeat === other.endBeat &&
                take.selected === other.selected &&
                take.sourceOffsetBeats === other.sourceOffsetBeats &&
                take.sourceOffsetSeconds === other.sourceOffsetSeconds &&
                take.passAnchorSeconds === other.passAnchorSeconds &&
                take.passDepthSeconds === other.passDepthSeconds &&
                take.passSourceEndSeconds === other.passSourceEndSeconds &&
                take.passOriginBeat === other.passOriginBeat &&
                take.passOriginSourceSeconds === other.passOriginSourceSeconds
            );
        })
    );
}

function regionsMatch(left: readonly CompRegion[], right: readonly CompRegion[]): boolean {
    return valuesEqual(left, right);
}

function reconcileLaneTransition(
    lane: TakeLane,
    transition: TakeReKeyLaneTransition,
    direction: TakeReKeyWriteDirection,
    requireLiveClipIds: () => ReadonlySet<string>
): TakeLane | null {
    const fromTakes = direction === 'apply' ? transition.takesBefore : transition.takesAfter;
    const toTakes = direction === 'apply' ? transition.takesAfter : transition.takesBefore;
    const fromRegions = direction === 'apply' ? transition.regionsBefore : transition.regionsAfter;
    const toRegions = direction === 'apply' ? transition.regionsAfter : transition.regionsBefore;

    const baseGaps = reconcileTransitionBaseGaps(lane, transition, direction);
    if (!baseGaps) {
        return null;
    }
    const takes = reconcileTransitionTakes(lane.takes, fromTakes, toTakes, requireLiveClipIds);
    const liveTakeIds = new Set(takes.map((take) => take.id));
    const removedTakeIds = new Set(lane.takes.filter((take) => !liveTakeIds.has(take.id)).map((take) => take.id));
    const regions = reconcileTransitionRegions(lane.activeCompRegions, fromRegions, toRegions, takes, removedTakeIds);
    const next = replaceBaseGapAudioSources({ ...lane, takes: [...takes], activeCompRegions: [...regions] }, baseGaps);
    if (
        takesMatch(lane.takes, takes) &&
        regionsMatch(lane.activeCompRegions, regions) &&
        valuesEqual(lane.baseGapAudioSources, next.baseGapAudioSources)
    ) {
        return null;
    }
    return next;
}

/**
 * Write one side of every captured re-key transition into the store, in one
 * atomic write. `apply` reproduces the post-operation facets (the forward
 * operation's own publish, and the redo leg of its restore plan); `restore`
 * puts the pre-operation facets back (the undo leg). Each lane reconciles
 * against live state rather than overwriting it, so a diverged store degrades
 * to a partial replay instead of a clobbered one, and a transition whose work
 * is already the live state costs no write.
 */
export function writeTakeReKeyTransitions(
    transitions: readonly TakeReKeyLaneTransition[],
    direction: TakeReKeyWriteDirection
): void {
    const state = takeLaneStore.value;
    if (!state || transitions.length === 0) {
        return;
    }

    // The clip ids currently in the project, collected once per write and only
    // when some lane re-adds a take or retains a take on a removed clip: the liveness checks
    // share one scan instead of rebuilding per-track clip lists per take.
    let liveClipIds: ReadonlySet<string> | null = null;
    const requireLiveClipIds = (): ReadonlySet<string> => {
        if (liveClipIds === null) {
            liveClipIds = collectLiveClipIds(getTrackStoreState()?.tracks ?? []);
        }
        return liveClipIds;
    };

    const lanes = [...state.lanes];
    let changed = false;
    for (const transition of transitions) {
        // The captured lane's own id, or the lane its track now owns — the
        // identity rule the retirement restore uses, so the two legs of one
        // operation never disagree about which lane they mean.
        const targetIndex = lanes.findIndex(
            (candidate) => candidate.id === transition.laneId || candidate.trackId === transition.trackId
        );
        if (targetIndex === -1) {
            continue;
        }
        const reconciled = reconcileLaneTransition(lanes[targetIndex]!, transition, direction, requireLiveClipIds);
        if (reconciled) {
            lanes[targetIndex] = reconciled;
            changed = true;
        }
    }

    if (changed) {
        takeLaneStore.set({ lanes });
    }
}
