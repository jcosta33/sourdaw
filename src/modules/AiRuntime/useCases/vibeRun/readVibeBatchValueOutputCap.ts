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
