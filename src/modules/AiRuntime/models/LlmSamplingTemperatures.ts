/**
 * Sampling temperatures for the LLM request paths. Temperature sets how
 * literally a model answers, and each path needs a different posture — an
 * explanation wants readable prose, a plain completion sits in the middle,
 * and a tool call must come back as exact JSON. The value a path sends is
 * part of its contract with the parser that consumes the reply, so each is
 * named once here rather than buried at its call site.
 */

/** Chat explanations: warm enough to read as prose, cool enough to stay on topic. */
export const EXPLAIN_TEMPERATURE = 0.7;

/** Default for a plain WebLLM completion when the caller does not pick one. */
export const WEB_LLM_COMPLETION_TEMPERATURE = 0.3;

/** Tool calling: near-deterministic, because the reply must parse as JSON. */
export const TOOL_CALLING_TEMPERATURE = 0.1;
