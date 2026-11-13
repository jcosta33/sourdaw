import { type AdoptedRecipe } from '../../models/AdoptedRecipe';

import { type VibeBatchDefaultsReason } from './chooseVibeBatchValues';

const VALUE_SOURCE_PHRASES: Readonly<Record<NonNullable<AdoptedRecipe['valueSource']>, string>> = {
    measurements: 'values chosen from measurements',
    'catalogue-defaults': 'catalogue defaults',
};

const DEFAULTS_REASON_PHRASES: Readonly<Record<VibeBatchDefaultsReason, string>> = {
    'local-backend': 'the run is on a local backend, which does not choose values',
    declined: 'the hosted provider declined to choose values',
    failed: 'the hosted value request failed',
    'correction-exhausted': 'the hosted reply was refused, and so was its correction',
    budget: "this run's budget had no room for the hosted value request",
};

/** How a recipe line says where its values came from; null for a recipe adopted outside a vibe run. */
export function describeRecipeValueSource(recipe: Pick<AdoptedRecipe, 'valueSource'>): string | null {
    return recipe.valueSource === undefined ? null : VALUE_SOURCE_PHRASES[recipe.valueSource];
}

/** The one line a vibe batch card gives when its recipes kept their catalogue defaults. */
export function describeCatalogueDefaultsReason(reason: VibeBatchDefaultsReason, detail: string): string {
    const stated = detail.trim().replace(/\.$/u, '');
    return `Recipe values are catalogue defaults: ${DEFAULTS_REASON_PHRASES[reason]}${stated === '' ? '' : ` (${stated})`}.`;
}
