import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { getCloudClient } from '../getCloudClient';

import { CLOUD_MODEL } from './helpers';

import type Anthropic from '@anthropic-ai/sdk';

const CLOUD_SYSTEM_PROMPT = `You are a professional music production AI integrated into a DAW (Digital Audio Workstation). Use the provided tools to execute all user requests. Never describe actions — execute them via tools. You understand music theory, mixing, mastering, and arrangement.

Key rules:
- Use multiple tools for complex requests (e.g. "set up a hip-hop session" = multiple addTrack + setTempo + addDevice calls)
- gain 0.0=silence, 0.8=unity/default, 1.0=maximum
- pan -50=hard left, 0=center, 50=hard right
- Bar 1 = beat 0, bar N = beat (N-1)*4 in 4/4 time
- MIDI: C4=60, 0.25=16th, 0.5=8th, 1=quarter, 4=whole note`;

function getClaudeTools(toolSchemas: readonly ToolSchema[]): Anthropic.Messages.Tool[] {
    return toolSchemas.map((schema) => ({
        name: schema.function.name,
        description: schema.function.description,
        input_schema: schema.function.parameters,
    }));
}

export const generateCloudToolCalls = inject({ logger })(
    ({ logger }) =>
        async function generateCloudToolCalls(
            systemPrompt: string,
            userMessage: string,
            toolSchemas: readonly ToolSchema[] = DAW_TOOL_SCHEMAS,
            signal?: AbortSignal
        ): Promise<ToolCallResult[]> {
            const client = getCloudClient();
            if (!client) {
                throw new Error('Cloud AI not configured. Set API key first.');
            }

            const response = await client.messages.create(
                {
                    model: CLOUD_MODEL,
                    max_tokens: 2048,
                    system: `${CLOUD_SYSTEM_PROMPT}\n\n${systemPrompt}`,
                    tools: getClaudeTools(toolSchemas),
                    messages: [
                        {
                            role: 'user',
                            content: userMessage,
                        },
                    ],
                },
                { signal }
            );

            const results: ToolCallResult[] = [];
            for (const block of response.content) {
                if (block.type === 'tool_use') {
                    results.push({
                        name: block.name,
                        arguments: (block.input ?? {}) as Record<string, unknown>,
                    });
                }
            }

            logger.info(
                `[Cloud AI] Claude returned ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
            );

            return results;
        }
);
