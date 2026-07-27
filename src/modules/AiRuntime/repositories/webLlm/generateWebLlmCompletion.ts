import { logger } from '#/infra/logger/appLogger';

import { engineState } from './engineLifecycleState';
import { initWebLlmEngine } from './initWebLlmEngine';

/**
 * Legacy text completion — kept for the chat assistant (non-command use).
 */
export async function generateWebLlmCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
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

    let response: {
        choices: Array<{ finish_reason?: string | null; message: { content: string } }>;
    };
    try {
        response = (await eng.chat.completions.create(payload)) as typeof response;
    } finally {
        options?.signal?.removeEventListener('abort', interruptGeneration);
    }
    options?.signal?.throwIfAborted();

    const choice = response.choices[0];
    if (!choice || choice.finish_reason !== 'stop') {
        throw new Error('WebLLM returned an incomplete completion');
    }

    const raw = choice.message.content;
    // Qwen3 prefixes answers with <think>...</think> reasoning blocks.
    // Strip them so callers receive only the final output.
    return raw.replaceAll(/<think>[\s\S]*?<\/think>/g, '').trim();
}
