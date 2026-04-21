import { createStore } from '#/infra/store/createStore';

import { type AdjustmentEffectType } from '#/modules/Arrangement/stores';

/**
 * Shape of a single scheduler-tick application of an adjustment layer.
 * Duplicated from `AdjustmentLayer` in Arrangement to keep engine-side code
 * free of cross-module model dependencies (AGENTS.md — model isolation).
 */
export type AppliedLayerRecord = {
    layerId: string;
    trackId: string;
    effectType: AdjustmentEffectType;
    blend: number;
    parameters: Record<string, number>;
    beat: number;
};

/**
 * Observable log of the adjustment layer applications that ran on the most
 * recent scheduler tick. Populated by the shared applier each tick; consumed
 * by UI overlays, the mix inspector, and engine integration tests.
 */
export type AdjustmentApplicationState = {
    applied: AppliedLayerRecord[];
};

export const adjustmentApplicationStore = createStore<AdjustmentApplicationState>({
    initialData: { applied: [] },
});
