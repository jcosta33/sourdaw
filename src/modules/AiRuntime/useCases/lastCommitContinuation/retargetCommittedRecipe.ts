import { getAddedDeviceParameterValues, getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type AdoptedRecipe } from '../../models/AdoptedRecipe';
import { denied } from '../../models/LastCommitRefusal';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../../models/LlmActionLimits';
import { type ProjectContext } from '../../models/ProjectContext';
import { expandMixRecipe } from '../expandMixRecipe';
import { groundApplicationRecipeBatch } from '../groundApplicationRecipeBatch';

import {
    type CommittedBatch,
    type CommittedCommand,
    type LastCommitContinuation,
    type RetargetRequest,
} from './lastCommitOutcome';
import { readRetargetTracks } from './readRetargetTracks';
import { trackName } from './trackName';

/** Names the authority and retained expansions of a recipe repeated from the last commit. */
const RECIPE_RETARGET_ORIGIN = 'last-commit-recipe';

type MixRecipeStep = ReturnType<typeof getMixRecipeCatalog>['recipes'][number]['steps'][number];

type MixRecipeParameter = MixRecipeStep['parameters'][number];

type ProjectContextTrack = ProjectContext['tracks'][number];

type RecipeValue = { step: number; paramId: string; value: number };

type CommittedRecipeValues = { status: 'read'; values: RecipeValue[] } | { status: 'refused'; reason: string };

/**
 * Whether the catalogue still publishes the committed recipe as the commit expanded it: a recipe it no
 * longer lists, or one published from a factory preset whose version has changed since, would repeat
 * something other than what was committed.
 */
function findRecipeChange(adopted: AdoptedRecipe): string | null {
    const recipe = getMixRecipeCatalog().recipes.find((candidate) => candidate.id === adopted.recipeId);
    if (recipe === undefined) {
        return `The recipe the last committed change applied, "${adopted.title}", is no longer in the recipe catalogue, so it cannot be repeated.`;
    }
    if (recipe.origin?.presetVersion !== adopted.presetVersion) {
        return `The factory preset behind the recipe the last committed change applied, "${adopted.title}", has changed since that change, so repeating it would not apply the same recipe.`;
    }
    return null;
}

/** The devices the commit's own inserts added. */
function readAddedDeviceIds(committed: CommittedBatch): Set<string> {
    const added = new Set<string>();
    for (const { type, payload } of committed.commands) {
        if (type === 'addDevice' && typeof payload.deviceId === 'string') {
            added.add(payload.deviceId);
        }
    }
    return added;
}

function withoutDevices(track: ProjectContextTrack, removed: ReadonlySet<string>): ProjectContextTrack {
    return { ...track, devices: track.devices.filter((device) => !removed.has(device.id)) };
}

/** The planning context with the committed track's chain as it stood before the commit's own inserts. */
function readContextBeforeCommit(
    committed: CommittedBatch,
    adopted: AdoptedRecipe,
    context: ProjectContext
): ProjectContext {
    const added = readAddedDeviceIds(committed);
    const tracks = context.tracks.map((track) =>
        track.id === adopted.targetId ? withoutDevices(track, added) : track
    );
    return { ...context, tracks };
}

/** Takes the first unpaired committed insert of the step's device type on the track, returning the device it added. */
function takeCommittedInsert(unpaired: CommittedCommand[], trackId: string, deviceType: string): string | null {
    const index = unpaired.findIndex(
        ({ type, payload }) =>
            type === 'addDevice' &&
            payload.trackId === trackId &&
            payload.deviceType === deviceType &&
            typeof payload.deviceId === 'string'
    );
    const [insert] = index === -1 ? [] : unpaired.splice(index, 1);
    return typeof insert?.payload.deviceId === 'string' ? insert.payload.deviceId : null;
}

/** The one live device of the step's type an edit step retunes, on the track as it stood before the commit. */
function readRetunedDevice(before: ProjectContext, trackId: string, deviceType: string): string | null {
    const devices = before.tracks.find((track) => track.id === trackId)?.devices ?? [];
    const matching = devices.filter((device) => device.type === deviceType && !device.bypassed);
    return matching.length === 1 ? (matching[0]?.id ?? null) : null;
}

/** The device a recipe step acted on in the commit: the one its insert added, or the one an edit retunes. */
function takeStepDevice(
    step: MixRecipeStep,
    unpaired: CommittedCommand[],
    trackId: string,
    before: ProjectContext
): string | null {
    if (step.kind === 'insert') {
        return takeCommittedInsert(unpaired, trackId, step.deviceType);
    }
    return readRetunedDevice(before, trackId, step.deviceType);
}

/** Takes the first unpaired committed write of the parameter to the device, when its value lies inside the window. */
function takeCommittedWrite(
    unpaired: CommittedCommand[],
    deviceId: string,
    parameter: MixRecipeParameter
): number | null {
    const index = unpaired.findIndex(
        ({ type, payload }) =>
            type === 'setDeviceParameter' &&
            payload.deviceId === deviceId &&
            payload.paramId === parameter.paramId &&
            typeof payload.value === 'number' &&
            payload.value >= parameter.minimum &&
            payload.value <= parameter.maximum
    );
    const [write] = index === -1 ? [] : unpaired.splice(index, 1);
    return typeof write?.payload.value === 'number' ? write.payload.value : null;
}

/**
 * The values the commit gave the adopted recipe, one per step and parameter, or why the committed batch
 * is not that recipe's expansion alone. Nothing the application records ties a committed command to the
 * recipe that built it, so each step is paired with the commit in the recipe's order: an insert with a
 * committed insert of its device type on the committed track, an edit with the one device of its type
 * the chain held before the commit, and each parameter with a write to that device inside its window.
 * A parameter of an inserted device the commit did not write keeps the value the device starts with,
 * as an expansion leaves out a write the added device already holds. A committed command that pairs
 * with nothing is named, so a provider command committed beside the recipe is never silently dropped
 * from the repeat, and the values must expand the recipe again on the committed track as it stood.
 */
function readCommittedRecipeValues(
    committed: CommittedBatch,
    adopted: AdoptedRecipe,
    context: ProjectContext
): CommittedRecipeValues {
    const incomplete: CommittedRecipeValues = {
        status: 'refused',
        reason: `The last committed change no longer reads as the recipe "${adopted.title}" expands on ${trackName(adopted.targetId, context)}, so it cannot be repeated as that recipe.`,
    };
    const recipe = getMixRecipeCatalog().recipes.find((candidate) => candidate.id === adopted.recipeId);
    if (recipe === undefined) {
        return incomplete;
    }
    const before = readContextBeforeCommit(committed, adopted, context);
    const unpaired = [...committed.commands];
    const values: RecipeValue[] = [];
    let complete = true;
    for (const [step, recipeStep] of recipe.steps.entries()) {
        const deviceId = takeStepDevice(recipeStep, unpaired, adopted.targetId, before);
        if (deviceId === null) {
            complete = false;
            continue;
        }
        const held = recipeStep.kind === 'insert' ? getAddedDeviceParameterValues(recipeStep.deviceType) : null;
        for (const parameter of recipeStep.parameters) {
            const value = takeCommittedWrite(unpaired, deviceId, parameter) ?? held?.[parameter.paramId];
            if (value === undefined) {
                complete = false;
                continue;
            }
            values.push({ step, paramId: parameter.paramId, value });
        }
    }
    const [beside] = unpaired;
    if (beside !== undefined) {
        return {
            status: 'refused',
            reason: `The last committed change holds "${beside.label}", which the recipe "${adopted.title}" does not produce, so it cannot be repeated as the recipe alone.`,
        };
    }
    const expanded = expandMixRecipe(
        { recipeId: adopted.recipeId, targetId: adopted.targetId, role: null, values },
        before,
        0
    );
    return complete && expanded.status === 'expanded' ? { status: 'read', values } : incomplete;
}

/**
 * The committed recipe expanded again on each named track, through the one expansion path and
 * against the planning context, so each expansion mints its own devices and never reuses the
 * committed track's. Every refusal names its reason, and the whole re-target is refused when any
 * named track cannot take the recipe.
 */
export function retargetCommittedRecipe(input: {
    request: RetargetRequest;
    committed: CommittedBatch;
    adopted: AdoptedRecipe;
    context: ProjectContext;
    projectRevision: string;
    prompt: string;
}): LastCommitContinuation {
    const { adopted, committed, context } = input;
    const recipeChange = findRecipeChange(adopted);
    if (recipeChange !== null) {
        return denied(recipeChange);
    }
    const committedValues = readCommittedRecipeValues(committed, adopted, context);
    if (committedValues.status === 'refused') {
        return denied(committedValues.reason);
    }
    const { values } = committedValues;
    const targets = readRetargetTracks(input.request, context);
    if (targets.status === 'refused') {
        return targets.outcome;
    }
    if (targets.ids.includes(adopted.targetId)) {
        return denied(`${trackName(adopted.targetId, context)} already took the last committed change.`);
    }
    const frozen = targets.ids.find((id) => context.tracks.find((track) => track.id === id)?.frozen === true);
    if (frozen !== undefined) {
        return denied(
            `${trackName(frozen, context)} is frozen, so the recipe "${adopted.title}" cannot be applied to it until it is unfrozen.`
        );
    }
    let commandCount = 0;
    for (const [ordinal, id] of targets.ids.entries()) {
        const expanded = expandMixRecipe(
            { recipeId: adopted.recipeId, targetId: id, role: null, values },
            context,
            ordinal
        );
        if (expanded.status === 'refused') {
            return denied(`${trackName(id, context)} cannot take the recipe "${adopted.title}": ${expanded.reason}`);
        }
        commandCount += expanded.commands.length;
    }
    if (commandCount > MAX_LLM_ACTIONS_PER_BATCH) {
        return denied(
            `Repeating the last committed change there takes ${String(commandCount)} commands, more than one batch of ${String(MAX_LLM_ACTIONS_PER_BATCH)} holds.`
        );
    }
    const [first, ...rest] = targets.ids.map((targetId) => ({
        recipeId: adopted.recipeId,
        targetId,
        role: null,
        values,
    }));
    if (first === undefined) {
        return denied('The request names no track to apply the recipe to.');
    }
    const batch = groundApplicationRecipeBatch({
        origin: RECIPE_RETARGET_ORIGIN,
        pairs: [first, ...rest],
        context,
        projectRevision: input.projectRevision,
        prompt: input.prompt,
    });
    switch (batch.status) {
        case 'refused-expansion':
            return denied(
                `${trackName(batch.pair.targetId, context)} cannot take the recipe "${adopted.title}": ${batch.reason}`
            );
        case 'rejected':
            return denied(`The repeated recipe could not be compiled: ${batch.reason}`);
        case 'not-compiled':
            return denied('The repeated recipe did not compile to a change for this project.');
        case 'grounded':
            return {
                status: 'recipe',
                grounded: batch.grounded,
                adoptedRecipes: batch.adoptedRecipes,
                creativeAuthority: batch.creativeAuthority,
            };
        default: {
            const exhaustive: never = batch;
            throw new Error(`Unsupported application recipe batch result: ${JSON.stringify(exhaustive)}`);
        }
    }
}
