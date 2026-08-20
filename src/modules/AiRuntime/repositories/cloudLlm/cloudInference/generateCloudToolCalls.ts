import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { FADER_GAIN_RANGE_DESCRIPTION } from '#/utils/audioLevelLaw';

import { isAiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { DAW_TOOL_SCHEMAS, type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { linkCloudRequestAbort } from '../linkCloudRequestAbort';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

import { generateAnthropicToolCalls } from './generateAnthropicToolCalls';
import { generateOpenAiCompatibleToolCalls } from './generateOpenAiCompatibleToolCalls';

const CLOUD_SYSTEM_PROMPT = `You are a professional music production AI integrated into a DAW (Digital Audio Workstation). Use the provided tools to execute all user requests. Never describe actions — execute them via tools. You understand music theory, mixing, mastering, and arrangement.

Key rules:
- Use multiple tools for complex requests (e.g. "set up a hip-hop session" = multiple addTrack + setTempo + addDevice calls)
- gain ${FADER_GAIN_RANGE_DESCRIPTION}
- pan -50=hard left, 0=center, 50=hard right
- Bar 1 = beat 0, bar N = beat (N-1)*4 in 4/4 time
- MIDI: C4=60, 0.25=16th, 0.5=8th, 1=quarter, 4=whole note`;

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
                throw new Error('Hosted AI is not configured');
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

                const results = await generateAnthropicToolCalls({
                    runtime,
                    systemPrompt: `${CLOUD_SYSTEM_PROMPT}\n\n${systemPrompt}`,
                    userMessage,
                    toolSchemas,
                    signal: controller.signal,
                });
                controller.signal.throwIfAborted();
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
