import { LOCAL_MODEL_TIERS, type LocalModelTier } from '../models/ModelInfo';

import type { MachineMemoryReading } from '../models/MachineMemoryReading';

type OfferableModel = { id: string; tier: LocalModelTier; memoryGb: number };

/** Without a memory figure the picker offers every tier up to this one and hides the larger ones. */
const LARGEST_TIER_WITHOUT_FIGURE: LocalModelTier = 'pro';

function tierRank(tier: LocalModelTier): number {
    return LOCAL_MODEL_TIERS.indexOf(tier);
}

/** The local models this machine can run: those whose memory figure its total memory clears, or, with no figure, every tier up to Pro. */
export function offeredLocalModels<TModel extends OfferableModel>(
    models: readonly TModel[],
    reading: MachineMemoryReading
): TModel[] {
    if (reading.state === 'known') {
        const totalGb = reading.totalBytes / 1e9;
        return models.filter((model) => totalGb >= model.memoryGb);
    }
    return models.filter((model) => tierRank(model.tier) <= tierRank(LARGEST_TIER_WITHOUT_FIGURE));
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
