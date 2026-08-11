import { type Store } from '#/infra/store/types';
import { executeAppAction } from '#/modules/Command/useCases';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../../stores/grandBouleStore';

/**
 * The Grand Boule config knobs that ride `Device.parameterValues`.
 *
 * Each name is simultaneously the `GRAND_BOULE_DESCRIPTOR` parameter id, the
 * `GrandBouleConfig` field, and the key `PARAM_MAP` (`grandBouleEngineCore.ts:56`)
 * translates to the engine's snake_case. That is not a coincidence to be relied on
 * quietly — `grandBouleParameterRegistry.spec.ts` derives the population from the
 * descriptor and holds all three alignments, so a rename on any side reds.
 *
 * The remaining knobs on the panel — Stretch, Bite, Velocity Curve, Morph — declare
 * no descriptor parameter and so have nowhere to be stored. See the PR body.
 */
export const GRAND_BOULE_PERSISTED_PARAM_IDS = [
    'masterGain',
    'soundboardSend',
    'sympatheticSend',
    'lidPosition',
    'micPosition',
] as const;

export type GrandBoulePersistedParamId = (typeof GRAND_BOULE_PERSISTED_PARAM_IDS)[number];

type DispatchGrandBouleParamInput = {
    /** Device id — the address project truth and the undo entry are keyed by. */
    deviceId: string;
    paramId: GrandBoulePersistedParamId;
    /** Already clamped by the caller to the range that parameter declares. */
    value: number;
    engine: GrandBouleEngineHandle;
    store: Store<GrandBouleState>;
    isTransient: boolean;
};

/**
 * Land one persisted Grand Boule control, splitting the gesture from its commit.
 *
 * The first persisted controls wrote
 * `createGrandBouleStore(deviceId)` — a module-level `Map` of session stores that
 * `resetGrandBouleStores()` wipes on project teardown — and pushed the value at the
 * engine handle. Nothing wrote `Device.parameterValues`, so the store's own
 * "Project-persistable" docstring described an intention rather than a behaviour,
 * and a voiced master gain was gone on the next reload.
 *
 * **A drag is one edit, not ninety.** `RotaryKnob` calls `onChange(value, true)` on
 * every pointer-move that crosses a step (`RotaryKnob.tsx:305`) and once more with
 * `false` on release (`:189`). The panel's `Knob` wrapper declared
 * `onChange: (value: number) => void` and dropped the flag, so there was no gesture
 * boundary to commit on. The transient half now previews on the engine and nothing
 * else; the commit half dispatches one `setDeviceParameter` through
 * `executeAppAction`, which is what puts the move inside an Automerge transaction
 * and on the undo stack.
 *
 * Cost per gesture: one action, one Automerge transaction, one undo entry, and zero
 * project-truth writes during the drag.
 *
 * The session store is written on both halves — the panel is controlled off it, so
 * a knob whose field did not move would snap back mid-drag.
 *
 * The commit half does **not** also call `engine.setParam`. `setDeviceParameter`
 * calls `updateDeviceParam`, which reaches the same worklet controls through
 * `TrackNode.updateParam`; pushing twice would be one redundant message per gesture
 * and, worse, two places that could disagree about the clamped value that actually
 * landed.
 */
export function dispatchGrandBouleParam({
    deviceId,
    paramId,
    value,
    engine,
    store,
    isTransient,
}: DispatchGrandBouleParamInput): void {
    const state = store.value;
    if (state === null) {
        return;
    }

    store.set({
        ...state,
        config: { ...state.config, [paramId]: value },
    });

    if (isTransient) {
        // camelCase on purpose: `PARAM_MAP` translates it to the engine's
        // snake_case, so the descriptor id is the only spelling any caller needs.
        engine.setParam({ name: paramId, value });
        return;
    }

    void executeAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId, paramId, value },
    });
}
