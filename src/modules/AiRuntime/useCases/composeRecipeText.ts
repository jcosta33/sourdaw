import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { formatAnswerNumber, quoteSourceData } from '../services/answerSourceFormat';

import { type RecipeDiscoveryReceiptData } from './discoverMixRecipes';

/** A switch reads as its state, a ranged parameter as its window and unit, and an empty unit says nothing. */
function authoredWindowText(
    descriptor: { type: string; unit: string },
    window: { minimum: number; maximum: number }
): string {
    if (descriptor.type === 'boolean') {
        if (window.minimum === window.maximum) {
            return window.minimum === 0 ? 'off' : 'on';
        }
        return 'on or off';
    }
    const range = `${formatAnswerNumber(window.minimum)}–${formatAnswerNumber(window.maximum)}`;
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
