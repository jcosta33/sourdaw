import { MAX_LLM_ACTIONS_PER_BATCH } from './LlmActionLimits';
import { SEMANTIC_COMMAND_LIST_MAX_ITEMS } from './SemanticCommandList';

/**
 * The most commands one recipe expansion may add to a batch. The batch ceiling bounds every
 * proposal, and the semantic list's item ceiling bounds the form a provider may combine an
 * expansion with, so an expansion over either could never be adopted whole next to its own list.
 * The provider schema, the argument parser and the expander all read this one figure, so a bound
 * written twice cannot drift.
 */
export const RECIPE_EXPANSION_MAX_COMMANDS = Math.min(MAX_LLM_ACTIONS_PER_BATCH, SEMANTIC_COMMAND_LIST_MAX_ITEMS);

/** Each supplied value replaces one `setDeviceParameter` command, so it cannot outnumber the commands. */
export const RECIPE_EXPANSION_MAX_VALUES = RECIPE_EXPANSION_MAX_COMMANDS;

/** A recipe step index is a position in the recipe's ordered steps, which cannot outnumber its commands. */
export const RECIPE_EXPANSION_MAX_STEP_INDEX = RECIPE_EXPANSION_MAX_COMMANDS - 1;

export const RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH = 64;

export const RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH = 256;
