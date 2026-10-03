import { getMixRecipeCatalog, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../models/ProjectContext';
import { RECIPE_EXPANSION_MAX_COMMANDS } from '../models/RecipeExpansionLimits';
import { type AdoptedRecipe, type RetainedCommand } from '../models/RetainedCompilation';

import { type RecipeExpansionInput } from './parseRecipeExpansionInput';
import {
    FOLDER_TARGET_WARNING,
    type ResolvedRole,
    type ResolvedTarget,
    resolveRecipeTarget,
} from './resolveRecipeTarget';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;
type MixRecipe = MixRecipeCatalog['recipes'][number];
type MixRecipeStep = MixRecipe['steps'][number];
type MixRecipeParameter = MixRecipeStep['parameters'][number];

/** One parameter's chosen value beside the window the recipe authored for it, in the parameter's native unit. */
export type ExpandedParameterValue = {
    step: number;
    paramId: string;
    value: number;
    minimum: number;
    maximum: number;
    source: 'supplied' | 'midpoint';
};

type Refusal = { status: 'refused'; reason: string };

export type ExpandMixRecipeResult =
    | Refusal
    | {
          status: 'expanded';
          catalogVersion: MixRecipeCatalog['version'];
          recipe: AdoptedRecipe;
          commands: readonly RetainedCommand[];
          values: readonly ExpandedParameterValue[];
      };

type StepContext = {
    index: number;
    recipe: MixRecipe;
    step: MixRecipeStep;
    supplied: RecipeExpansionInput['values'];
    target: ResolvedTarget;
};

type ChosenValues = { status: 'chosen'; values: readonly ExpandedParameterValue[] } | Refusal;

type EditedCommands = { status: 'edited'; commands: readonly RetainedCommand[] } | Refusal;

/** Enough significant digits for any authored window, few enough to drop float noise like 0.44999999999999996. */
const MIDPOINT_SIGNIFICANT_DIGITS = 12;

const MAX_LISTED_DEVICE_IDS = 5;

function refuse(reason: string): Refusal {
    return { status: 'refused', reason };
}

function describeWindow(parameter: MixRecipeParameter): string {
    return `${String(parameter.minimum)} to ${String(parameter.maximum)}`;
}

function insertKey(stepIndex: number): string {
    return `step-${String(stepIndex)}-insert`;
}

function parameterKey(stepIndex: number, paramId: string): string {
    return `step-${String(stepIndex)}-${paramId}`;
}

/**
 * A binding is unique across a batch because the loop hands every expansion its own ordinal, so two
 * expansions of one recipe on two tracks never mint the same name.
 */
function deviceBinding(ordinal: number, stepIndex: number): string {
    return `recipe-${String(ordinal)}-${String(stepIndex)}`;
}

function listDeviceIds(ids: readonly string[]): string {
    const listed = ids.slice(0, MAX_LISTED_DEVICE_IDS).join(', ');
    const omitted = ids.length - MAX_LISTED_DEVICE_IDS;
    if (omitted <= 0) {
        return listed;
    }
    return `${listed} and ${String(omitted)} more`;
}

/** What a recipe may never be applied to, whatever its values: a folder, a frozen track, or another role. */
function findTargetRefusal(recipe: MixRecipe, target: ResolvedTarget, role: ResolvedRole): Refusal | null {
    if (target.kind === 'folder') {
        return refuse(`recipe.expand refused target "${target.id}": ${FOLDER_TARGET_WARNING}`);
    }
    if (target.frozen) {
        return refuse(
            `recipe.expand refused target "${target.id}": it is frozen, and device changes are refused while it is frozen.`
        );
    }
    if (role.recipeRole === null) {
        return refuse(
            `recipe.expand cannot tell which recipe role target "${target.id}" has (its canonical role is ${target.canonicalRole}); pass a role argument.`
        );
    }
    if (!recipe.roles.includes(role.recipeRole)) {
        return refuse(
            `recipe "${recipe.id}" is authored for ${recipe.roles.join(', ')}, but target "${target.id}" resolves to ${role.recipeRole}.`
        );
    }
    return null;
}

/** A supplied value must name a step and parameter the recipe has, and sit inside that parameter's window. */
function findValueRefusal(recipe: MixRecipe, supplied: RecipeExpansionInput['values']): Refusal | null {
    for (const entry of supplied) {
        const step = recipe.steps[entry.step];
        if (step === undefined) {
            return refuse(
                `values names step ${String(entry.step)}, but recipe "${recipe.id}" has ${String(recipe.steps.length)} step(s), numbered from 0.`
            );
        }
        const parameter = step.parameters.find((candidate) => candidate.paramId === entry.paramId);
        if (parameter === undefined) {
            const known = step.parameters.map((candidate) => candidate.paramId).join(', ');
            return refuse(
                `values names parameter ${entry.paramId}, which step ${String(entry.step)} of recipe "${recipe.id}" does not have; its parameters are ${known}.`
            );
        }
        if (entry.value < parameter.minimum || entry.value > parameter.maximum) {
            return refuse(
                `values gives ${entry.paramId} of step ${String(entry.step)} the value ${String(entry.value)}, outside its window ${describeWindow(parameter)}.`
            );
        }
    }
    return null;
}

/**
 * The value a parameter takes when none is supplied: the middle of its window, resolved onto the
 * descriptor's own legal settings so a discrete parameter never lands between two of them.
 */
function chooseMidpoint(deviceType: string, parameter: MixRecipeParameter): number {
    const midpoint = Number(((parameter.minimum + parameter.maximum) / 2).toPrecision(MIDPOINT_SIGNIFICANT_DIGITS));
    return quantiseDeviceParameterValue({ deviceType, paramId: parameter.paramId, value: midpoint });
}

/**
 * A supplied value was already held to its window by `findValueRefusal`. Only a midpoint is checked
 * here, because snapping it onto a legal setting can carry it out of a window narrower than the
 * gap between two settings.
 */
function chooseValue(
    context: StepContext,
    parameter: MixRecipeParameter
): { status: 'chosen'; value: ExpandedParameterValue } | Refusal {
    const window = {
        step: context.index,
        paramId: parameter.paramId,
        minimum: parameter.minimum,
        maximum: parameter.maximum,
    };
    const supplied = context.supplied.find(
        (entry) => entry.step === context.index && entry.paramId === parameter.paramId
    );
    if (supplied !== undefined) {
        return { status: 'chosen', value: { ...window, value: supplied.value, source: 'supplied' } };
    }
    const value = chooseMidpoint(context.step.deviceType, parameter);
    if (value < parameter.minimum || value > parameter.maximum) {
        return refuse(
            `${parameter.paramId} of step ${String(context.index)} has no legal setting inside its window ${describeWindow(parameter)}; supply a value.`
        );
    }
    return { status: 'chosen', value: { ...window, value, source: 'midpoint' } };
}

function chooseStepValues(context: StepContext): ChosenValues {
    const values: ExpandedParameterValue[] = [];
    for (const parameter of context.step.parameters) {
        const chosen = chooseValue(context, parameter);
        if (chosen.status === 'refused') {
            return chosen;
        }
        values.push(chosen.value);
    }
    return { status: 'chosen', values };
}

/** Which recipe step a command was lowered from, in the words the transform compiler uses for its own. */
function describeProvenance(context: StepContext, operation: string) {
    return {
        stepId: `step-${String(context.index)}`,
        reason: `Mixing recipe "${context.recipe.id}" step ${String(context.index)}.`,
        expectedEffect: `${operation} lowered from mixing recipe "${context.recipe.id}".`,
    };
}

function toParameterCommand(
    context: StepContext,
    chosen: ExpandedParameterValue,
    deviceId: string,
    dependencyKeys: readonly string[]
): RetainedCommand {
    return {
        key: parameterKey(context.index, chosen.paramId),
        operation: 'setDeviceParameter',
        arguments: { deviceId, paramId: chosen.paramId, value: chosen.value },
        binding: null,
        dependencyKeys,
        ...describeProvenance(context, 'setDeviceParameter'),
    };
}

/**
 * One `addDevice` for the step, then one parameter write per authored parameter on the device it
 * mints. The first insert goes after the chain's current last device; a later one goes after the
 * previous insert's device, so the recipe's order survives into the chain.
 */
function expandInsertStep(
    context: StepContext,
    chosen: readonly ExpandedParameterValue[],
    previousInsertIndex: number | null,
    ordinal: number
): RetainedCommand[] {
    const binding = deviceBinding(ordinal, context.index);
    const key = insertKey(context.index);
    const addArguments: Record<string, unknown> = {
        trackId: context.target.id,
        deviceType: context.step.deviceType,
    };
    const addDependencyKeys: string[] = [];
    if (previousInsertIndex === null) {
        const lastDevice = context.target.devices.at(-1);
        if (lastDevice !== undefined) {
            addArguments.afterDeviceId = lastDevice.id;
        }
    } else {
        addArguments.afterDeviceId = `$${deviceBinding(ordinal, previousInsertIndex)}`;
        addDependencyKeys.push(insertKey(previousInsertIndex));
    }
    const addCommand: RetainedCommand = {
        key,
        operation: 'addDevice',
        arguments: addArguments,
        binding,
        dependencyKeys: addDependencyKeys,
        ...describeProvenance(context, 'addDevice'),
    };
    const parameterCommands = chosen.map((entry) => toParameterCommand(context, entry, `$${binding}`, [key]));
    return [addCommand, ...parameterCommands];
}

/** A retune needs exactly one live device of the step's type to retune; naming none or several is a refusal. */
function expandEditStep(context: StepContext, chosen: readonly ExpandedParameterValue[]): EditedCommands {
    const { deviceType } = context.step;
    const matching = context.target.devices.filter((device) => device.type === deviceType && !device.bypassed);
    const [device] = matching;
    if (device === undefined) {
        return refuse(
            `step ${String(context.index)} of recipe "${context.recipe.id}" retunes ${deviceType}, but target "${context.target.id}" has no non-bypassed ${deviceType}.`
        );
    }
    if (matching.length > 1) {
        const ids = listDeviceIds(matching.map((candidate) => candidate.id));
        return refuse(
            `step ${String(context.index)} of recipe "${context.recipe.id}" retunes ${deviceType}, but target "${context.target.id}" has ${String(matching.length)} non-bypassed ones (${ids}), so the device to retune is ambiguous.`
        );
    }
    return {
        status: 'edited',
        commands: chosen.map((entry) => toParameterCommand(context, entry, device.id, [])),
    };
}

/**
 * Expands one authored recipe against one concrete track into the ordinary catalog commands a
 * batch carries: `addDevice` for each insert step and `setDeviceParameter` for every authored
 * parameter, in the recipe's order. The expansion is a pure reading of the recipe and the project
 * read model. It writes nothing, and the commands it returns reach the project only when a
 * proposal adopts them and passes every grounding and validation step a hand-written item passes.
 */
export function expandMixRecipe(
    input: RecipeExpansionInput,
    context: ProjectContext,
    ordinal: number
): ExpandMixRecipeResult {
    const catalog = getMixRecipeCatalog();
    const recipe = catalog.recipes.find((candidate) => candidate.id === input.recipeId);
    if (recipe === undefined) {
        return refuse(`recipe.expand recipeId "${input.recipeId}" is not a recipe in the catalog.`);
    }
    const resolution = resolveRecipeTarget({
        catalog,
        tracks: context.tracks,
        targetId: input.targetId,
        roleArgument: input.role,
    });
    if (resolution.status === 'not-found' || resolution.target === null) {
        return refuse(`recipe.expand targetId "${input.targetId}" is not a track in the project.`);
    }
    const { target, role } = resolution;
    const refusal = findTargetRefusal(recipe, target, role) ?? findValueRefusal(recipe, input.values);
    if (refusal !== null) {
        return refusal;
    }

    const commands: RetainedCommand[] = [];
    const values: ExpandedParameterValue[] = [];
    let previousInsertIndex: number | null = null;
    for (const [index, step] of recipe.steps.entries()) {
        const stepContext: StepContext = { index, recipe, step, supplied: input.values, target };
        const chosen = chooseStepValues(stepContext);
        if (chosen.status === 'refused') {
            return chosen;
        }
        values.push(...chosen.values);
        if (step.kind === 'insert') {
            commands.push(...expandInsertStep(stepContext, chosen.values, previousInsertIndex, ordinal));
            previousInsertIndex = index;
            continue;
        }
        const edited = expandEditStep(stepContext, chosen.values);
        if (edited.status === 'refused') {
            return edited;
        }
        commands.push(...edited.commands);
    }
    if (commands.length > RECIPE_EXPANSION_MAX_COMMANDS) {
        return refuse(
            `recipe "${recipe.id}" expands to ${String(commands.length)} commands, above the ${String(RECIPE_EXPANSION_MAX_COMMANDS)} one expansion may add to a batch.`
        );
    }
    return {
        status: 'expanded',
        catalogVersion: catalog.version,
        recipe: { recipeId: recipe.id, title: recipe.title, targetId: target.id },
        commands,
        values,
    };
}
