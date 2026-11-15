import { DEFAULT_WEBLLM_MODEL_ID } from '../../models/ModelInfo';
import { chooseOfferedModel } from '../../transformers/offeredLocalModels';

import type { WEBLLM_MODELS } from './modelInfo';

type CatalogueModel = (typeof WEBLLM_MODELS)[number];

/** The offered model to show selected, preferring the wanted one; null when the machine fits none. */
export function chooseLocalModel(offered: readonly CatalogueModel[], wantedId: string): CatalogueModel | null {
    return chooseOfferedModel(offered, wantedId, DEFAULT_WEBLLM_MODEL_ID);
}
