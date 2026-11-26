import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { quoteSourceData } from '../services/answerSourceFormat';

import { type RecipeDiscoveryReceiptData } from './discoverMixRecipes';

const MAXIMUM_WINDOW_DECIMALS = 8;

function roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}

/** Two decimals, widened only until a nonzero end stays nonzero and distinct ends stay distinct. */
function windowDecimals(window: { minimum: number; maximum: number }): number {
    for (let decimals = 2; decimals < MAXIMUM_WINDOW_DECIMALS; decimals += 1) {
        const minimum = roundTo(window.minimum, decimals);
        const maximum = roundTo(window.maximum, decimals);
        const zeroed = (window.minimum !== 0 && minimum === 0) || (window.maximum !== 0 && maximum === 0);
        const merged = window.minimum !== window.maximum && minimum === maximum;
        if (!zeroed && !merged) {
            return decimals;
        }
    }
    return MAXIMUM_WINDOW_DECIMALS;
}

function numericWindowText(window: { minimum: number; maximum: number }): string {
    const decimals = windowDecimals(window);
    return `${roundTo(window.minimum, decimals)}–${roundTo(window.maximum, decimals)}`;
}

function choiceWindowText(labels: readonly string[], window: { minimum: number; maximum: number }): string | null {
    const minimum = labels[window.minimum];
    const maximum = labels[window.maximum];
    if (minimum === undefined || maximum === undefined) {
        return null;
    }
    if (window.minimum === window.maximum) {
        return quoteSourceData(minimum);
    }
    return `${quoteSourceData(minimum)}–${quoteSourceData(maximum)}`;
}

/**
 * A switch reads as its state, a choice as its option labels, a ranged parameter as its window and
 * unit, and an empty unit says nothing.
 */
function authoredWindowText(
    descriptor: { type: string; unit: string; enumValues: readonly string[] | null },
    window: { minimum: number; maximum: number }
): string {
    if (descriptor.type === 'boolean') {
        if (window.minimum === window.maximum) {
            return window.minimum === 0 ? 'off' : 'on';
        }
        return 'on or off';
    }
    if (descriptor.type === 'enum' && descriptor.enumValues !== null) {
        const choices = choiceWindowText(descriptor.enumValues, window);
        if (choices !== null) {
            return choices;
        }
    }
    const range = numericWindowText(window);
    if (descriptor.unit === '') {
        return range;
    }
    return `${range} ${quoteSourceData(descriptor.unit)}`;
}

export function composeRecipeText(recipe: RecipeDiscoveryReceiptData['candidates'][number]): string {
    const descriptors = getAgentBuiltinDeviceFactoryManifest(recipe.steps.map((step) => step.deviceType));
    const windows = recipe.steps.flatMap((step) =>
        step.parameters.flatMap((parameter) => {
            const descriptor = descriptors
                .find((entry) => entry.type === step.deviceType)
                ?.parameters.find((entry) => entry.id === parameter.paramId);
            if (
                descriptor === undefined ||
                !Number.isFinite(parameter.minimum) ||
                !Number.isFinite(parameter.maximum)
            ) {
                return [];
            }
            return [`${quoteSourceData(descriptor.name)} ${authoredWindowText(descriptor, parameter)}`];
        })
    );
    const character =
        recipe.descriptor === null || recipe.effect === null
            ? 'carries no perceptual descriptor'
            : `describes ${quoteSourceData(recipe.descriptor)} (${quoteSourceData(recipe.effect)})`;
    let text = `The catalog recipe ${quoteSourceData(recipe.title)} ${character}. These are authored suggestions, not measurements of this project.`;
    if (recipe.prerequisites.length > 0) {
        text += ` Prerequisites: ${recipe.prerequisites.map(quoteSourceData).join('; ')}.`;
    }
    if (recipe.contraindications.length > 0) {
        text += ` Contraindications: ${recipe.contraindications.map(quoteSourceData).join('; ')}.`;
    }
    if (windows.length > 0) {
        text += ` Authored parameter windows: ${windows.join('; ')}.`;
    }
    return text;
}
