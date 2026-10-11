/** Tokens the local model's window keeps free for the planning reply; a request leaving less is refused. */
export const LOCAL_PLANNING_REPLY_RESERVE_TOKENS = 2_048;

/** Tokens the chat template wraps around the system and user messages, the empty thinking block included. */
export const LOCAL_PLANNING_TEMPLATE_OVERHEAD_TOKENS = 32;

/** The failure code of a local planning request that does not fit the local model's context window. */
export const LOCAL_CONTEXT_WINDOW_EXCEEDED_FAILURE_CODE = 'local-context-window-exceeded';

/**
 * Counts the tokens a text costs the local model. The budget reads tokens only through this port,
 * so the conservative estimate it ships with can be replaced by the model's own tokenizer.
 */
export type PromptTokenCounter = (text: string) => number;

export type LocalPlanningBudget =
    | { status: 'admitted'; promptTokens: number; maxOutputTokens: number }
    | { status: 'exceeded'; neededTokens: number; windowTokens: number };
