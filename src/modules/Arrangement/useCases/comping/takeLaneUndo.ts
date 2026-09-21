import { pushUndoEntry } from '#/modules/Command/useCases';

import { type CompRegion, type Take, type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';

import { insertTakeLane } from './insertTakeLane';
import { laneWithLiveTakes } from './laneWithLiveTakes';
import { removeTakeLane } from './removeTakeLane';
import { resolveTakeLaneIndex } from './resolveTakeLaneIndex';

type TakeLaneFacetState =
    | { readonly kind: 'takes'; readonly value: readonly Take[] }
    | { readonly kind: 'activeCompRegions'; readonly value: readonly CompRegion[] };

type TargetedTakeLaneEdit =
    | {
          readonly kind: 'facet';
          readonly label: string;
          readonly laneId: string;
          readonly before: TakeLaneFacetState;
          readonly after: TakeLaneFacetState;
      }
    | { readonly kind: 'lane-added'; readonly label: string; readonly lane: TakeLane; readonly laneIndex: number }
    | { readonly kind: 'lane-removed'; readonly label: string; readonly lane: TakeLane; readonly laneIndex: number };

function lanePresent(lanes: readonly TakeLane[], laneId: string): boolean {
    return lanes.some((existing) => existing.id === laneId);
}

function applyFacetState(laneId: string, facet: TakeLaneFacetState): void {
    const state = takeLaneStore.value;
    if (!state || !lanePresent(state.lanes, laneId)) {
        return;
    }
    // Whichever facet is being replayed, the lane goes back through the one liveness
    // rule: a take whose clip is gone is not part of the state any more, and neither is
    // a region that names it.
    takeLaneStore.set({
        lanes: state.lanes.map((existing) => {
            if (existing.id !== laneId) {
                return existing;
            }
            if (facet.kind === 'takes') {
                return laneWithLiveTakes({ ...existing, takes: [...facet.value] });
            }
            return laneWithLiveTakes({ ...existing, activeCompRegions: [...facet.value] });
        }),
    });
}

/**
 * Undo entry for a take-lane edit whose capture holds only the state the edit
 * actually changed (#4081): one lane's takes, one lane's comp regions, or one
 * lane's presence. The inverse rewrites that state inside the store's state at
 * undo time, so edits made after the entry — to other lanes or to the same
 * lane's other facets — survive undo and redo instead of being erased by a
 * whole-store snapshot replay.
 *
 * A removed lane's redo removes the lane the undo merged into: the undo puts the
 * captured lane back through `insertTakeLane`, which merges it into whatever lane the
 * track owns, and a projection's lane no longer matches the captured id. Removing by
 * id alone there leaves the redo inert over a lane nobody names.
 */
export function pushTargetedTakeLaneUndoEntry(edit: TargetedTakeLaneEdit): void {
    const undo = () => {
        if (edit.kind === 'facet') {
            applyFacetState(edit.laneId, edit.before);
            return;
        }
        if (edit.kind === 'lane-added') {
            removeTakeLane(edit.lane.id);
            return;
        }
        insertTakeLane(laneWithLiveTakes(edit.lane), edit.laneIndex);
    };
    const redo = () => {
        if (edit.kind === 'facet') {
            applyFacetState(edit.laneId, edit.after);
            return;
        }
        if (edit.kind === 'lane-added') {
            insertTakeLane(laneWithLiveTakes(edit.lane), edit.laneIndex);
            return;
        }
        const lanes = takeLaneStore.value?.lanes ?? [];
        const landedIndex = resolveTakeLaneIndex(lanes, edit.lane);
        if (landedIndex !== -1) {
            removeTakeLane(lanes[landedIndex]!.id);
        }
    };
    pushUndoEntry(edit.label, undo, redo);
}
