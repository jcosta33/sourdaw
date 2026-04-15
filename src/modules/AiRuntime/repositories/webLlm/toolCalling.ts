import { type ChatCompletionTool } from '@mlc-ai/web-llm';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { parseToolCallXml, type ToolCallResult } from '../../transformers/toolCallParser';
import { generateWebLlmCompletion } from './engineLifecycle';

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
            tools: ChatCompletionTool[]
        ): Promise<ToolCallResult[]> {
            const toolDescriptions = tools
                .map((t) => {
                    const params = t.function.parameters as Record<string, unknown> | undefined;
                    const paramStr = params ? ` Parameters: ${JSON.stringify(params)}` : '';
                    return `- ${t.function.name}: ${t.function.description ?? ''}${paramStr}`;
                })
                .join('\n');

            const fullSystemPrompt = [
                systemPrompt,
                '',
                'Available tools:',
                toolDescriptions,
                '',
                'Respond with a JSON array of tool calls: [{"name":"tool_name","arguments":{...}}]',
                'Output ONLY valid JSON. No markdown, no explanation.',
            ].join('\n');

            const response = await generateWebLlmCompletion(fullSystemPrompt, userMessage, { temperature: 0.1 });
            logger.info(`[WebLLM] Response (${String(response.length)} chars): ${response.slice(0, 200)}`);
            return parseToolCallXml(response);
        }
);
