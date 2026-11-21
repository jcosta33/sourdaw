import { LOCAL_PLANNING_REPLY_RESERVE_TOKENS } from '../models/LocalPlanningBudget';
import { WEBLLM_MODELS } from '../models/ModelInfo';

const TOKEN_FORMAT = new Intl.NumberFormat('en-US');

// web-llm's ContextWindowSizeExceededError text, raised when the engine's own tokenizer finds the
// prompt longer than the loaded window.
const ENGINE_CONTEXT_WINDOW_ERROR = /Prompt tokens exceed context window size/;
const ENGINE_CONTEXT_WINDOW_FIGURES = /number of prompt tokens: (\d+); context window size: (\d+)/;

export type LocalContextWindowShortfall = { neededTokens: number; windowTokens: number };

/**
 * The user-visible refusal of a planning request made on a local model that does not plan.
 * `offeredPlannerNames` are the display names of the planning models this machine is offered;
 * with none, the refusal points to a hosted model alone.
 */
export function describeLocalPlannerRequired(activeModelId: string, offeredPlannerNames: readonly string[]): string {
    const active = WEBLLM_MODELS.find((model) => model.id === activeModelId)?.displayName ?? 'This';
    const refusal = `The ${active} local model cannot plan project edits.`;
    if (offeredPlannerNames.length === 0) {
        return `${refusal} Use a hosted model.`;
    }
    const planners = offeredPlannerNames.map((name) => `the ${name} local model`);
    return `${refusal} Switch to ${planners.join(' or ')}, or use a hosted model.`;
}

/** The user-visible refusal of any local-model request on a machine whose memory fits no local model. */
export function describeNoLocalModelOffered(): string {
    return 'This machine has too little memory to run any local model. Use a hosted model.';
}

/**
 * The user-visible refusal of a local planning request the local model's window cannot hold.
 * `largerLocalModel` names a local model whose window would hold it, when there is one.
 */
export function describeLocalContextWindowShortfall(
    shortfall: LocalContextWindowShortfall,
    largerLocalModel?: string
): string {
    const remedy =
        largerLocalModel === undefined
            ? 'Use a hosted model for a request this large.'
            : `Switch to the ${largerLocalModel} local model, whose window holds it, or use a hosted model.`;
    return (
        `This request needs about ${TOKEN_FORMAT.format(shortfall.neededTokens)} tokens of the local model's ` +
        `context window, ${TOKEN_FORMAT.format(LOCAL_PLANNING_REPLY_RESERVE_TOKENS)} of them reserved for its reply, ` +
        `and the window holds ${TOKEN_FORMAT.format(shortfall.windowTokens)}. ${remedy}`
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
