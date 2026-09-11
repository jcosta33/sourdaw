import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { generateDrumFill } from '../../useCases/fillTransitionGeneration/generateDrumFill';

import {
    describeFillPlacement,
    executeFillPlacement,
    type FillPlacementPlan,
    type FillPlacementRefusal,
} from './fillPlacement';
import { findDrumMidiTrack } from './generationHandlerHelpers';

type GenerateFillAction = Extract<AppAction, { type: 'generateFill' }>;

/**
 * #3765 — the generator result is actually placed: one MIDI clip on the
 * resolved drum track spanning the fill plus the closing crash beat, written
 * through the normal undoable action path (see `fillPlacement.ts`).
 */
function buildFillPlan(alpha: GenerateFillAction): FillPlacementPlan | FillPlacementRefusal {
    const atBeat = alpha.payload.atBeat;
    const durationBeats = alpha.payload.durationBeats ?? 2;
    const style = alpha.payload.style ?? 'descending';

    if (!Number.isFinite(atBeat) || atBeat < 0 || !Number.isFinite(durationBeats) || durationBeats <= 0) {
        return {
            message: `Cannot generate a drum fill at beat ${String(atBeat)} — the placement beat is invalid`,
            level: 'error',
        };
    }

    const fill = generateDrumFill(atBeat, durationBeats, style);
    if (fill.notes.length === 0) {
        return { message: 'The drum fill generator produced no notes — nothing was placed', level: 'warning' };
    }

    return {
        clipName: `Fill (${style})`,
        absoluteNotes: fill.notes,
        targetTrack: findDrumMidiTrack(),
        fillCount: 1,
    };
}

export const handleGenerateFill = createHandler<'generateFill'>({
    execute: (alpha) =>
        executeFillPlacement({
            action: alpha,
            buildPlan: () => buildFillPlan(alpha),
            successMessage: (placement) =>
                `Placed ${placement.noteCount}-note drum fill on "${placement.trackName}" at beat ${placement.startBeat}`,
        }),
    describe: (alpha) =>
        describeFillPlacement({ action: alpha, label: 'Generate Fill', buildPlan: () => buildFillPlan(alpha) }),
    undoable: true,
});
