import { getAddedDeviceParameterValues, type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { chooseRecipeMidpoint } from './chooseRecipeMidpoint';
import { isWriteHeldByAddedDevice } from './isWriteHeldByAddedDevice';

type MixRecipe = ReturnType<typeof getMixRecipeCatalog>['recipes'][number];
type MixRecipeStep = MixRecipe['steps'][number];

/** One `addDevice`, then a write for each parameter whose middle value the added device does not already hold. */
function countInsertStepCommands(step: MixRecipeStep): number {
    const held = getAddedDeviceParameterValues(step.deviceType);
    const writes = step.parameters.filter(
        (parameter) =>
            !isWriteHeldByAddedDevice(held, parameter.paramId, chooseRecipeMidpoint(step.deviceType, parameter))
    );
    return 1 + writes.length;
}

/**
 * How many commands expanding the recipe with no supplied values adds to a batch: for each insert
 * step one `addDevice` and a `setDeviceParameter` for every parameter the added device does not
 * already hold at its chosen value, and for each edit step one `setDeviceParameter` per parameter.
 * This is the count `recipe.expand` holds against the batch ceiling, so discovery can withhold a
 * recipe the expander would refuse.
 */
export function countRecipeExpansionCommands(recipe: MixRecipe): number {
    return recipe.steps.reduce(
        (total, step) => total + (step.kind === 'insert' ? countInsertStepCommands(step) : step.parameters.length),
        0
    );
}
