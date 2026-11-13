import { type getMixRecipeCatalog } from '#/modules/Arrangement/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ToolSchema } from '../../models/ToolDefinitions';
import {
    type ScheduledVibeRunBatch,
    type VibeRunInitialEvidence,
    type VibeRunVerificationRange,
} from '../../models/VibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { chooseRecipeMidpoint } from '../chooseRecipeMidpoint';
import { type MetricGoal } from '../metricGoalContractTypes';
import { objectiveMetricProjection } from '../objectiveMetricProjection';

import { readVibeBatchRecipeGoals } from './readVibeBatchRecipeGoals';
import { readVibeTargetName } from './readVibeTargetName';

type MixRecipeCatalog = ReturnType<typeof getMixRecipeCatalog>;

export const VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME = 'recipeValues.choose';
export const VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME = 'recipeValues.keepDefaults';

/**
 * The reply's fixed part: the tool call wrapper, the `choices` array and a short reasoning
 * preamble a reasoning model may spend before it calls, which is why the base is not near zero.
 */
const VALUE_REPLY_BASE_OUTPUT_TOKENS = 1_024;
/** One `{ targetId, recipeId, values }` wrapper: two identifiers of a few tokens each and the brackets. */
const VALUE_REPLY_TOKENS_PER_PAIR = 48;
/** One `{ step, paramId, value }` entry: a step index, a parameter id of a few tokens and one number. */
const VALUE_REPLY_TOKENS_PER_VALUE = 32;

/**
 * The output a reply needs at most: pairs × wrapper tokens plus parameters × tokens per value,
 * over the fixed base. A batch carries at most a few targets with a few short recipes each, so
 * this stays far below the planner's own output ceiling, which the request is held to as well.
 */
export function readVibeBatchValueOutputCap(pairCount: number, parameterCount: number): number {
    return (
        VALUE_REPLY_BASE_OUTPUT_TOKENS +
        pairCount * VALUE_REPLY_TOKENS_PER_PAIR +
        parameterCount * VALUE_REPLY_TOKENS_PER_VALUE
    );
}

/** One recipe parameter as the provider may set it: its step, its device and its authored window. */
export type VibeBatchValueParameter = {
    readonly step: number;
    readonly deviceType: string;
    readonly paramId: string;
    readonly minimum: number;
    readonly maximum: number;
    readonly catalogueDefault: number;
};

/** One recipe on one target of the batch, with every parameter the reply must give a value for. */
export type VibeBatchValuePair = {
    readonly targetId: string;
    readonly recipeId: string;
    readonly parameters: readonly VibeBatchValueParameter[];
};

export type VibeBatchValueRequest = {
    readonly pairs: readonly VibeBatchValuePair[];
    readonly systemPrompt: string;
    readonly userMessage: string;
    readonly tools: readonly ToolSchema[];
    readonly maxOutputTokens: number;
};

export type BuiltVibeBatchValueRequest =
    { status: 'built'; request: VibeBatchValueRequest } | { status: 'refused'; reason: string };

type Figure = { range: string; value: number; unit: string };

const SYSTEM_PROMPT = `You choose parameter values for mixing recipes the application has already chosen for a batch of tracks.
Each recipe parameter has an authored window [minimum, maximum] in its own unit and a catalogue default.
Each track carries its measured baseline figures for the metrics its recipes are expected to move, keyed by the ranges the request lists (the arrangement and each section); a range marked silent carries no signal.
Choose, for every pair and every parameter, one value inside its window that suits that track's baselines, then call ${VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME} once with every pair and every parameter.
If the figures give no reason to depart from the catalogue defaults, call ${VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME} with a short reason instead.
Call exactly one tool, once. Never add or remove pairs or parameters.`;

const NUMBER_VALUE = { type: 'number' };

const CHOOSE_TOOL: ToolSchema = {
    type: 'function',
    function: {
        name: VIBE_BATCH_VALUE_CHOOSE_TOOL_NAME,
        description: 'Give every parameter of every listed recipe-and-track pair one value inside its authored window.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['choices'],
            properties: {
                choices: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['targetId', 'recipeId', 'values'],
                        properties: {
                            targetId: { type: 'string' },
                            recipeId: { type: 'string' },
                            values: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['step', 'paramId', 'value'],
                                    properties: {
                                        step: { type: 'integer' },
                                        paramId: { type: 'string' },
                                        value: NUMBER_VALUE,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};

const KEEP_DEFAULTS_TOOL: ToolSchema = {
    type: 'function',
    function: {
        name: VIBE_BATCH_VALUE_KEEP_DEFAULTS_TOOL_NAME,
        description: 'Keep every recipe parameter at its catalogue default, saying why in one short sentence.',
        parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['reason'],
            properties: { reason: { type: 'string' } },
        },
    },
};

export const VIBE_BATCH_VALUE_TOOLS: readonly ToolSchema[] = [CHOOSE_TOOL, KEEP_DEFAULTS_TOOL];

/**
 * Significant digits a baseline figure is stated to. A value choice reads the figure's size, not its
 * last digits, and the request is held to the run's hosted planning budget byte by byte, so every
 * figure of every range of every pair costs what its digits cost.
 */
const FIGURE_SIGNIFICANT_DIGITS = 4;

function rangeKey(range: VibeRunVerificationRange): string {
    return range.sectionId ?? 'arrangement';
}

/** The one figure the plan's own witness holds for this goal, as the stored-plan reader validates it. */
function readGoalFigure(goal: MetricGoal, initial: VibeRunInitialEvidence): Figure | null {
    if (goal.metricId === null || goal.range === null) {
        return null;
    }
    const witness = initial.witnesses.find((candidate) => candidate.id === goal.goalId);
    const receipt = readVibeRunInitialReceipt(
        initial.receipts.find((candidate) => candidate.callId === witness?.receiptCallId)
    );
    const entry = receipt?.data.targets.find((target) => goal.targetIds.includes(target.targetId))?.measurements[
        goal.metricId
    ];
    const projected = objectiveMetricProjection(goal.metricId, entry, goal.band);
    if (projected === null) {
        return null;
    }
    return {
        range: rangeKey(goal.range),
        value: Number(projected.value.toPrecision(FIGURE_SIGNIFICANT_DIGITS)),
        unit: projected.unit,
    };
}

function readSilentRangeKeys(batch: ScheduledVibeRunBatch, targetId: string): string[] {
    return (batch.silentRanges ?? []).filter((cell) => cell.targetId === targetId).map((cell) => rangeKey(cell.range));
}

/**
 * One metric's figures keyed by range, in the order the batch's ranges are stated: each range
 * the target was measured over carries its figure, and each it is silent over says `silent`.
 */
function keyFigures(
    ranges: readonly VibeRunVerificationRange[],
    measured: readonly Figure[],
    silent: readonly string[]
): Record<string, number | 'silent'> {
    const figures: Record<string, number | 'silent'> = {};
    for (const range of ranges) {
        const key = rangeKey(range);
        const figure = measured.find((candidate) => candidate.range === key);
        if (figure !== undefined) {
            figures[key] = figure.value;
        } else if (silent.includes(key)) {
            figures[key] = 'silent';
        }
    }
    return figures;
}

/**
 * The hosted value request for one stored vibe batch: for each recipe-and-track pair, that target's
 * initial baseline figure for each metric the recipe expects to move, over the arrangement and each
 * section (or that it is silent there), and every recipe parameter with its authored window and its
 * catalogue default. Figures only: no receipt, artifact descriptor or sample reaches the request.
 * It is a pure reading of the plan, so the whole-run fit builds the same request it will send.
 */
export function buildVibeBatchValueRequest(input: {
    batch: ScheduledVibeRunBatch;
    initial: VibeRunInitialEvidence;
    catalog: MixRecipeCatalog;
    context: Pick<ProjectContext, 'tracks'>;
}): BuiltVibeBatchValueRequest {
    const goals = readVibeBatchRecipeGoals({
        batch: input.batch,
        catalog: input.catalog,
        range: input.initial.arrangementRange,
    });
    if (goals.status === 'refused') {
        return goals;
    }
    const ranges = input.batch.verificationRanges ?? [];
    const pairs: VibeBatchValuePair[] = [];
    const described: unknown[] = [];
    for (const pair of goals.pairs) {
        const recipe = input.catalog.recipes.find((candidate) => candidate.id === pair.recipeId);
        if (recipe === undefined) {
            return { status: 'refused', reason: `recipe ${pair.recipeId} is no longer an authored recipe` };
        }
        const parameters = recipe.steps.flatMap((step, index) =>
            step.parameters.map((parameter) => ({
                step: index,
                deviceType: step.deviceType,
                paramId: parameter.paramId,
                minimum: parameter.minimum,
                maximum: parameter.maximum,
                catalogueDefault: chooseRecipeMidpoint(step.deviceType, parameter),
            }))
        );
        const silent = readSilentRangeKeys(input.batch, pair.targetId);
        const baselines = recipe.metrics.map((expectation, expectationIndex) => {
            const measured = goals.goals
                .filter(
                    (goal) =>
                        goal.stepId === pair.stepId &&
                        goal.source.kind === 'recipe' &&
                        goal.source.expectationIndex === expectationIndex
                )
                .flatMap((goal) => readGoalFigure(goal, input.initial) ?? []);
            return {
                metric: expectation.metric,
                band: expectation.band ?? null,
                expected: expectation.direction,
                unit: measured[0]?.unit ?? null,
                figures: keyFigures(ranges, measured, silent),
            };
        });
        pairs.push({ targetId: pair.targetId, recipeId: pair.recipeId, parameters });
        described.push({
            targetId: pair.targetId,
            targetName: readVibeTargetName(input.context, pair.targetId),
            role: input.batch.objective.role,
            recipeId: recipe.id,
            recipeTitle: recipe.title,
            descriptor: recipe.descriptor,
            baselines,
            // The device type only tells the application how to quantise; the provider reads windows.
            parameters: parameters.map((parameter) => ({
                step: parameter.step,
                paramId: parameter.paramId,
                minimum: parameter.minimum,
                maximum: parameter.maximum,
                catalogueDefault: parameter.catalogueDefault,
            })),
        });
    }
    const parameterCount = pairs.reduce((sum, pair) => sum + pair.parameters.length, 0);
    const userMessage = JSON.stringify({
        batch: {
            id: input.batch.id,
            descriptors: input.batch.objective.descriptors,
            role: input.batch.objective.role,
        },
        ranges: ranges.map((range) => ({ range: rangeKey(range), startBeat: range.startBeat, endBeat: range.endBeat })),
        pairs: described,
    });
    return {
        status: 'built',
        request: {
            pairs,
            systemPrompt: SYSTEM_PROMPT,
            userMessage,
            tools: VIBE_BATCH_VALUE_TOOLS,
            maxOutputTokens: readVibeBatchValueOutputCap(pairs.length, parameterCount),
        },
    };
}
