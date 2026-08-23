import { type Store } from '#/infra/store/types';
/**
 * Update the Grand Boule stretched-tuning amount.
 *
 * 0.0 = no smooth stretch, leaving equal temperament plus project-authored
 * note variation; 1.0 = the default project curve; 2.0 = exaggerated
 * stretch. Note variation is preserved regardless of this knob.
 */

import { type GrandBouleEngineHandle } from '../repositories/grandBouleEngineHandle';
import { type GrandBouleState } from '../stores/grandBouleStore';

type SetGrandBouleStretchAmountInput = {
    engine: GrandBouleEngineHandle;
    amount: number;
    store: Store<GrandBouleState>;
};

export function setGrandBouleStretchAmount(input: SetGrandBouleStretchAmountInput): void {
    const state = input.store.value;
    if (state === null) {
        return;
    }
    const clamped = Math.max(0, Math.min(2, input.amount));
    input.store.set({
        ...state,
        config: { ...state.config, stretchAmount: clamped },
    });
    input.engine.setParam({ name: 'stretch_amount', value: clamped });
}
