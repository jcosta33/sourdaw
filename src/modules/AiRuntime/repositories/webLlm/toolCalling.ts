import { type ChatCompletionTool } from '@mlc-ai/web-llm';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { TOOL_CALLING_TEMPERATURE } from '../../models/LlmSamplingTemperatures';
import { serializeWebLlmToolPlanningPrompt } from '../../transformers/serializeWebLlmToolPlanningPrompt';
import { parseToolPlanningOutcome, type ToolPlanningOutcome } from '../../transformers/toolCallParser';

import { generateWebLlmCompletion } from './generateWebLlmCompletion';

/**
 * Generate tool calls via Qwen3 text completion + JSON parsing.
 * Qwen3 does not support the ChatCompletionRequest.tools API — tool schemas
 * are embedded directly in the system prompt and the JSON response is parsed.
 * Tool planning never thinks aloud: a thinking block spends the reply budget
 * the request was admitted with before the first tool call.
 */
export const generateWebLlmToolCalls = inject({ logger })(
    ({ logger }) =>
        async function generateWebLlmToolCalls(
            systemPrompt: string,
            userMessage: string,
            tools: ChatCompletionTool[],
            maxOutputTokensOrSignal?: number | AbortSignal,
            signal?: AbortSignal,
            estimatedPromptTokens?: number
        ): Promise<ToolPlanningOutcome> {
            const maxTokens = typeof maxOutputTokensOrSignal === 'number' ? maxOutputTokensOrSignal : undefined;
            const actualSignal = maxOutputTokensOrSignal instanceof AbortSignal ? maxOutputTokensOrSignal : signal;

            const response = await generateWebLlmCompletion(
                serializeWebLlmToolPlanningPrompt(systemPrompt, tools),
                userMessage,
                {
                    temperature: TOOL_CALLING_TEMPERATURE,
                    maxTokens,
                    signal: actualSignal,
                    requireComplete: true,
                    enableThinking: false,
                    estimatedPromptTokens,
                }
            );
            logger.info(`[WebLLM] Response (${String(response.length)} chars): ${response.slice(0, 200)}`);
            return parseToolPlanningOutcome(response);
        }
);
