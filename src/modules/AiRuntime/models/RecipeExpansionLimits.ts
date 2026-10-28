import { MAX_LLM_ACTIONS_PER_BATCH } from './LlmActionLimits';

/**
 * The most commands one recipe expansion may add to a batch. The batch ceiling bounds every
 * proposal. Retained recipes can be adopted without a provider semantic list; when combined
 * with other commands, the whole proposal is still subject to the batch ceiling.
 * The provider schema, the argument parser and the expander all read this one figure, so a bound
 * written twice cannot drift.
 */
export const RECIPE_EXPANSION_MAX_COMMANDS = MAX_LLM_ACTIONS_PER_BATCH;

/** Each supplied value replaces one `setDeviceParameter` command, so it cannot outnumber the commands. */
export const RECIPE_EXPANSION_MAX_VALUES = RECIPE_EXPANSION_MAX_COMMANDS;

/** A recipe step index is a position in the recipe's ordered steps, which cannot outnumber its commands. */
export const RECIPE_EXPANSION_MAX_STEP_INDEX = RECIPE_EXPANSION_MAX_COMMANDS - 1;

export const RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH = 64;

export const RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH = 256;
