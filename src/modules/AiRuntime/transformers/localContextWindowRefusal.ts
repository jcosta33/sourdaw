import { LOCAL_PLANNING_REPLY_RESERVE_TOKENS } from '../models/LocalPlanningBudget';

const TOKEN_FORMAT = new Intl.NumberFormat('en-US');

// web-llm's ContextWindowSizeExceededError text, raised when the engine's own tokenizer finds the
// prompt longer than the loaded window.
const ENGINE_CONTEXT_WINDOW_ERROR = /Prompt tokens exceed context window size/;
const ENGINE_CONTEXT_WINDOW_FIGURES = /number of prompt tokens: (\d+); context window size: (\d+)/;

export type LocalContextWindowShortfall = { neededTokens: number; windowTokens: number };

/** The user-visible refusal of a local planning request the local model's window cannot hold. */
export function describeLocalContextWindowShortfall(shortfall: LocalContextWindowShortfall): string {
    return (
        `This request needs about ${TOKEN_FORMAT.format(shortfall.neededTokens)} tokens of the local model's ` +
        `context window, ${TOKEN_FORMAT.format(LOCAL_PLANNING_REPLY_RESERVE_TOKENS)} of them reserved for its reply, ` +
        `and the window holds ${TOKEN_FORMAT.format(shortfall.windowTokens)}. Use a hosted model for a request this large.`
    );
}

/**
 * Reads web-llm's context-window overflow out of an engine failure. The engine names the prompt it
 * counted and its window; a message without those figures falls back to the request's own budget.
 */
export function readEngineContextWindowShortfall(
    error: unknown,
    fallback: LocalContextWindowShortfall
): LocalContextWindowShortfall | null {
    const message = error instanceof Error ? error.message : String(error);
    if (!ENGINE_CONTEXT_WINDOW_ERROR.test(message)) {
        return null;
    }
    const figures = ENGINE_CONTEXT_WINDOW_FIGURES.exec(message);
    if (figures === null) {
        return fallback;
    }
    return {
        neededTokens: Number(figures[1]) + LOCAL_PLANNING_REPLY_RESERVE_TOKENS,
        windowTokens: Number(figures[2]),
    };
}
