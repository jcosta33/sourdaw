import { type ChatCompletionTool } from '@mlc-ai/web-llm';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { parseToolPlanningOutcome, type ToolPlanningOutcome } from '../../transformers/toolCallParser';

import { generateWebLlmCompletion } from './generateWebLlmCompletion';

/**
 * Generate tool calls via Qwen3 text completion + JSON parsing.
 * Qwen3 does not support the ChatCompletionRequest.tools API — tool schemas
 * are embedded directly in the system prompt and the JSON response is parsed.
 */
export const generateWebLlmToolCalls = inject({ logger })(
    ({ logger }) =>
        async function generateWebLlmToolCalls(
            systemPrompt: string,
            userMessage: string,
            tools: ChatCompletionTool[],
            maxOutputTokensOrSignal?: number | AbortSignal,
            signal?: AbortSignal
        ): Promise<ToolPlanningOutcome> {
            const maxTokens = typeof maxOutputTokensOrSignal === 'number' ? maxOutputTokensOrSignal : undefined;
            const actualSignal = maxOutputTokensOrSignal instanceof AbortSignal ? maxOutputTokensOrSignal : signal;
            const toolDescriptions = tools
                .map((time) => {
                    const params = time.function.parameters;
                    const paramStr = params ? ` Parameters: ${JSON.stringify(params)}` : '';
                    return `- ${time.function.name}: ${time.function.description ?? ''}${paramStr}`;
                })
                .join('\n');

            const fullSystemPrompt = [
                systemPrompt,
                '',
                'Available tools:',
                toolDescriptions,
                '',
                'Respond with a JSON array of tool calls: [{"id":"unique_call_id","name":"tool_name","arguments":{...}}]',
                'Output ONLY valid JSON. No markdown, no explanation.',
            ].join('\n');

            const response = await generateWebLlmCompletion(fullSystemPrompt, userMessage, {
                temperature: 0.1,
                maxTokens,
                signal: actualSignal,
                requireComplete: true,
            });
            logger.info(`[WebLLM] Response (${String(response.length)} chars): ${response.slice(0, 200)}`);
            return parseToolPlanningOutcome(response);
        }
);
