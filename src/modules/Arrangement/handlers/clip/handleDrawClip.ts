import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { addClip } from '../../useCases/clip/addClip';
import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { type RippleInsertPlan, planRippleInsert } from '../../useCases/rippleInsert/planRippleInsert';
import { rippleInsertClip } from '../../useCases/rippleInsert/rippleInsertClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';
import { isDrawClipSessionEntry } from '../validateCreationSessionEntries';

type DrawClipAction = Extract<AppAction, { type: 'drawClip' }>;

type DrawClipState = {
    clipId: string;
    plan: RippleInsertPlan | null;
};

const drawClipStates = new WeakMap<object, DrawClipState>();

/**
 * Mints the drawn clip's identity and, when the payload asks for ripple, the
 * insert plan on first touch. `describe` runs before `execute`, so the plan is
 * computed against pre-write positions — the same "plan BEFORE adding the clip"
 * ordering the gesture callback had — and the memoized state hands `execute` the
 * identical plan instead of a second, post-describe computation.
 */
function getDrawClipState(action: DrawClipAction): DrawClipState {
    const existing = drawClipStates.get(action);
    if (existing) {
        return existing;
    }
    const state = {
        clipId: action.payload.id ?? getNextAppActionClipId(),
        plan: action.payload.ripple
            ? planRippleInsert({
                  trackId: action.payload.trackId,
                  insertBeat: action.payload.startBeat,
                  insertDuration: action.payload.endBeat - action.payload.startBeat,
              })
            : null,
    };
    drawClipStates.set(action, state);
    return state;
}

/** An empty plan shifts nothing: the draw degrades to a plain one, undo included. */
function appliedRipplePlan(state: DrawClipState): RippleInsertPlan | null {
    return state.plan !== null && state.plan.shiftedClips.length > 0 ? state.plan : null;
}

export const handleDrawClip = createHandler<'drawClip'>({
    execute: (action) => {
        const state = getDrawClipState(action);
        const clip = addClip({
            id: state.clipId,
            trackId: action.payload.trackId,
            startBeat: action.payload.startBeat,
            endBeat: action.payload.endBeat,
            name: action.payload.name,
            type: action.payload.type,
        });
        if (!clip) {
            return toHandlerExecutionResult(false);
        }
        const plan = appliedRipplePlan(state);
        if (plan) {
            rippleInsertClip({
                trackId: action.payload.trackId,
                insertDuration: action.payload.endBeat - action.payload.startBeat,
                plan,
            });
        }
        return toHandlerExecutionResult(true);
    },
    describe: (action) => {
        const state = getDrawClipState(action);
        const plan = appliedRipplePlan(state);
        return {
            label: plan ? 'Draw clip (ripple)' : 'Draw clip',
            inverseAction: {
                type: 'discardDrawnClip',
                payload: {
                    clipId: state.clipId,
                    trackId: action.payload.trackId,
                    ripplePlan: plan ? { shiftedClips: structuredClone(plan.shiftedClips) } : null,
                },
            },
            // Redo replays the captured plan through `restoreDrawnClip` rather
            // than re-dispatching the forward draw: re-planning live would
            // quietly diverge from the recorded edit once the ripple preference
            // or the surrounding clips change (the deleteTime describe-finalize
            // precedent — redo restores captured state, never re-runs the op).
            redoAction: {
                type: 'restoreDrawnClip',
                payload: {
                    clipId: state.clipId,
                    trackId: action.payload.trackId,
                    startBeat: action.payload.startBeat,
                    endBeat: action.payload.endBeat,
                    name: action.payload.name,
                    type: action.payload.type,
                    ripplePlan: plan ? { shiftedClips: structuredClone(plan.shiftedClips) } : null,
                },
            },
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    validateSessionEntry: isDrawClipSessionEntry,
});
