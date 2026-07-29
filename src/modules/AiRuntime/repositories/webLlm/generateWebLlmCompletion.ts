import { logger } from '#/infra/logger/appLogger';

import { ToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';

import { engineState } from './engineLifecycleState';
import { initWebLlmEngine } from './initWebLlmEngine';

type GenerateWebLlmCompletionOptions = {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    requireComplete?: boolean;
};

/**
 * Legacy text completion — kept for the chat assistant (non-command use).
 * `requireComplete` adds tool-planning protocol validation without changing
 * the default string-consumer contract.
 */
export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: GenerateWebLlmCompletionOptions
): Promise<string> {
    options?.signal?.throwIfAborted();
    const eng = await initWebLlmEngine(undefined, { signal: options?.signal });
    options?.signal?.throwIfAborted();
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
    ];
    const payload: Record<string, unknown> = {
        messages,
        temperature: options?.temperature ?? 0.3,
        max_tokens: options?.maxTokens ?? 2048,
        seed: 0,
    };

    // WebLLM's native `tools` API only works on Hermes builds — not the Qwen3
    // model we ship. Log payload keys (never contents) so a stray `tools:`
    // attachment surfaces cleanly instead of as an `UnsupportedModelIdError`.
    logger.info(`[WebLLM] completion model=${engineState.activeModelId} keys=${Object.keys(payload).sort().join(',')}`);

    function interruptGeneration(): void {
        eng.interruptGenerate();
    }
    options?.signal?.addEventListener('abort', interruptGeneration, { once: true });

    let response: unknown;
    try {
        response = await eng.chat.completions.create(payload);
    } finally {
        options?.signal?.removeEventListener('abort', interruptGeneration);
    }
    options?.signal?.throwIfAborted();

    let raw: string;
    if (options?.requireComplete) {
        raw = readCompleteToolPlanningResponse(response);
    } else {
        const compatibleResponse = response as {
            choices: Array<{ finish_reason?: string | null; message: { content: string } }>;
        };
        const choice = compatibleResponse.choices[0];
        if (!choice || choice.finish_reason !== 'stop') {
            throw new Error('WebLLM returned an incomplete completion');
        }
        raw = choice.message.content;
    }

    // Qwen3 prefixes answers with <think>...</think> reasoning blocks.
    // Strip them so callers receive only the final output.
    return raw.replaceAll(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function readCompleteToolPlanningResponse(response: unknown): string {
    if (!isRecord(response) || !Array.isArray(response.choices) || response.choices.length !== 1) {
        throw new ToolPlanningRejectedError('Invalid WebLLM tool-planning response: expected one choice');
    }
    const choice: unknown = response.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
        throw new ToolPlanningRejectedError(
            'Invalid WebLLM tool-planning response: expected a message with string content'
        );
    }
    if (choice.finish_reason !== 'stop') {
        throw new ToolPlanningRejectedError(
            `WebLLM tool planning did not complete (finish_reason: ${String(choice.finish_reason)})`
        );
    }
    return choice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
