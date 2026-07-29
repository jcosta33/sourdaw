import { isTauri } from '#/utils/tauriBridge';

import { ToolPlanningRejectedError } from '../../errors/ToolPlanningRejectedError';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';
import { BASE_URL } from './lifecycleState';

type GenerateNativeCompletionOptions = {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    requireComplete?: boolean;
};

/**
 * Non-streaming completion.
 * In Tauri: in-process inference via mistral.rs.
 * In browser dev mode: direct fetch to localhost llama-server.
 * `requireComplete` validates browser llama-server metadata only; the Tauri
 * command currently returns text without finish metadata and keeps its string contract.
 */
export async function generateNativeCompletion(
    systemPrompt: string,
    userMessage: string,
    options?: GenerateNativeCompletionOptions
): Promise<string> {
    if (isTauri()) {
        const response = await invokeCancelableNativeLlm({
            command: 'generate_native_completion',
            args: {
                systemPrompt,
                userMessage,
                temperature: options?.temperature ?? 0.1,
                maxTokens: options?.maxTokens ?? 2048,
            },
            signal: options?.signal,
            abortMessage: 'Native completion aborted',
        });
        if (typeof response !== 'string') {
            throw new TypeError('Invalid generate_native_completion response: expected a string');
        }
        return response;
    }

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        signal: options?.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            temperature: options?.temperature ?? 0.1,
            max_tokens: options?.maxTokens ?? 2048,
            seed: 0,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const data = (await response.json()) as unknown;
    if (options?.requireComplete) {
        return readCompleteBrowserResponse(data);
    }
    const compatibleData = data as { choices: Array<{ message: { content: string | null } }> };
    return compatibleData.choices[0]?.message.content ?? '';
}

function readCompleteBrowserResponse(data: unknown): string {
    if (!isRecord(data) || !Array.isArray(data.choices) || data.choices.length !== 1) {
        throw new ToolPlanningRejectedError('Invalid native text tool-planning response: expected one choice');
    }
    const choice: unknown = data.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string') {
        throw new ToolPlanningRejectedError(
            'Invalid native text tool-planning response: expected a message with string content'
        );
    }
    if (choice.finish_reason !== 'stop') {
        throw new ToolPlanningRejectedError(
            `Native text tool planning did not complete (finish_reason: ${String(choice.finish_reason)})`
        );
    }
    return choice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
