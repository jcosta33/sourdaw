import { LOCAL_MODEL_TIERS, type LocalModelTier } from '../models/ModelInfo';

import type { MachineMemoryReading } from '../models/MachineMemoryReading';

type OfferableModel = { id: string; tier: LocalModelTier; memoryGb: number };

/**
 * With no GPU memory budget the picker offers tiers up to this one on total RAM alone, and never offers a
 * larger tier (Large) without a GPU figure that clears its need.
 */
const LARGEST_TIER_WITHOUT_FIGURE: LocalModelTier = 'pro';

function tierRank(tier: LocalModelTier): number {
    return LOCAL_MODEL_TIERS.indexOf(tier);
}

function fitsGpu(model: OfferableModel, gpuBudgetGb: number | null): boolean {
    if (gpuBudgetGb === null) {
        return isWithoutFigureTier(model.tier);
    }
    return gpuBudgetGb >= model.memoryGb;
}

function isWithoutFigureTier(tier: LocalModelTier): boolean {
    return tierRank(tier) <= tierRank(LARGEST_TIER_WITHOUT_FIGURE);
}

/**
 * The local models this machine can run. With a known reading a model is offered when total RAM clears its
 * memory figure and the GPU budget does too; with no GPU budget, only tiers up to Pro are offered, on RAM
 * alone. With no reading, every tier up to Pro.
 */
export function offeredLocalModels<TModel extends OfferableModel>(
    models: readonly TModel[],
    reading: MachineMemoryReading
): TModel[] {
    if (reading.state === 'known') {
        const totalGb = reading.totalBytes / 1e9;
        const gpuBudgetGb = reading.gpuBudgetBytes === null ? null : reading.gpuBudgetBytes / 1e9;
        return models.filter((model) => totalGb >= model.memoryGb && fitsGpu(model, gpuBudgetGb));
    }
    return models.filter((model) => isWithoutFigureTier(model.tier));
}

/**
 * The model the picker selects: the wanted one when offered, else the default when offered, else the
 * largest offered. Null when nothing is offered.
 */
export function chooseOfferedModel<TModel extends OfferableModel>(
    offered: readonly TModel[],
    wantedId: string,
    defaultId: string
): TModel | null {
    const wanted = offered.find((model) => model.id === wantedId);
    if (wanted !== undefined) {
        return wanted;
    }
    const fallback = offered.find((model) => model.id === defaultId);
    if (fallback !== undefined) {
        return fallback;
    }
    return offered.reduce<TModel | null>(
        (largest, model) => (largest === null || model.memoryGb > largest.memoryGb ? model : largest),
        null
    );
}
