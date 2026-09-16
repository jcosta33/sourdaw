import { createHandler } from '#/utils/createHandler';

import { detectTransitionPoints } from '../../useCases/fillTransitionGeneration/detectTransitionPoints';
import { generateAllTransitionFills } from '../../useCases/fillTransitionGeneration/generateAllTransitionFills';

import {
    describeFillPlacement,
    executeFillPlacement,
    type FillPlacementPlan,
    type FillPlacementRefusal,
} from './fillPlacement';
import { findDrumMidiTrack } from './generationHandlerHelpers';

/**
 * #3765 — generated transition fills are actually placed: one MIDI clip on the
 * resolved drum track holding every boundary fill at its generated position,
 * written through the normal undoable action path (see `fillPlacement.ts`).
 * The single clip is what makes undo honest — an undo entry carries one
 * inverse action, and the guarded single-clip discard covers every boundary at
 * once.
 */
function buildTransitionsPlan(): FillPlacementPlan | FillPlacementRefusal {
    const boundaryCount = detectTransitionPoints().length;
    // A fill whose window starts before the project cannot form a valid clip;
    // skipping it (and refusing when nothing remains) beats lying with a
    // degenerate placement.
    const placeable = generateAllTransitionFills().filter(
        (fill) =>
            fill.notes.length > 0 && fill.notes.every((note) => Number.isFinite(note.startBeat) && note.startBeat >= 0)
    );

    if (placeable.length === 0) {
        if (boundaryCount === 0) {
            return { message: 'No section boundaries found — add sections first', level: 'warning' };
        }
        return { message: 'Section boundaries fall before the project start — no fills were placed', level: 'warning' };
    }

    return {
        clipName: 'Transition fills',
        absoluteNotes: placeable.flatMap((fill) => fill.notes),
        targetTrack: findDrumMidiTrack(),
        fillCount: placeable.length,
    };
}

export const handleGenerateAllTransitions = createHandler<'generateAllTransitions'>({
    execute: (alpha) =>
        executeFillPlacement({
            action: alpha,
            buildPlan: buildTransitionsPlan,
            successMessage: (placement) =>
                `Placed ${placement.fillCount} transition fills (${placement.noteCount} notes) on "${placement.trackName}" at beat ${placement.startBeat}`,
        }),
    describe: (alpha) =>
        describeFillPlacement({
            action: alpha,
            label: 'Generate All Transitions',
            buildPlan: buildTransitionsPlan,
        }),
    undoable: true,
});
