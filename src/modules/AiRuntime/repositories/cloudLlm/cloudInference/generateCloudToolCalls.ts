import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { getCloudClient } from '../getCloudClient';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { linkCloudRequestAbort } from '../linkCloudRequestAbort';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

import { generateOpenAiCompatibleToolCalls } from './generateOpenAiCompatibleToolCalls';
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const generateCloudToolCalls = inject({ logger })(
    ({ logger }) =>
        async function generateCloudToolCalls(
            systemPrompt: string,
            userMessage: string,
            toolSchemas: readonly ToolSchema[] = DAW_TOOL_SCHEMAS,
            signal?: AbortSignal
        ): Promise<ToolCallResult[]> {
            const runtime = getCloudProviderRuntime();
            if (!runtime) {
                throw new Error('Cloud AI not configured. Set API key first.');
            }

            const controller = registerCloudStreamController(new AbortController());
            const unlinkCallerAbort = linkCloudRequestAbort(signal, controller);

            try {
                if (runtime.provider !== 'anthropic') {
                    const results = await generateOpenAiCompatibleToolCalls({
                        runtime,
                        systemPrompt,
                        userMessage,
                        toolSchemas,
                        signal: controller.signal,
                    });
                    controller.signal.throwIfAborted();
                    return results;
                }

                const client = getCloudClient();
                if (!client) {
                    throw new Error('Anthropic client unavailable');
                }

                const response = await client.messages.create(
                    {
                        model: runtime.model || CLOUD_MODEL,
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
                    { signal: controller.signal }
                );
                controller.signal.throwIfAborted();

                const results: ToolCallResult[] = [];
                for (const block of response.content) {
                    if (block.type === 'tool_use') {
                        if (
                            typeof block.name !== 'string' ||
                            block.name.trim().length === 0 ||
                            !isRecord(block.input)
                        ) {
                            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
                        }
                        results.push({
                            name: block.name,
                            arguments: block.input,
                        });
                    }
                }
                const hasValidToolStop = response.stop_reason === 'tool_use' && results.length > 0;
                const hasNonToolText = response.content.some(
                    (block) => block.type === 'text' && block.text.trim().length > 0
                );
                const hasValidEmptyStop =
                    response.stop_reason === 'end_turn' && results.length === 0 && !hasNonToolText;
                if (response.stop_reason === 'end_turn' && results.length === 0 && hasNonToolText) {
                    throw new ToolPlanningRejectedError(
                        'Hosted AI returned a non-tool response instead of a tool-call batch'
                    );
                }
                if (!hasValidToolStop && !hasValidEmptyStop) {
                    throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
                }

                logger.info(
                    `[Cloud AI] Claude returned ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`
                );

                return results;
            } catch (error) {
                if (isAiRuntimeConfigurationChangedError(controller.signal.reason)) {
                    throw controller.signal.reason;
                }
                throw error;
            } finally {
                unlinkCallerAbort();
                unregisterCloudStreamController(controller);
            }
        }
);
