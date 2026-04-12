import { type ChatCompletionMessageParam, type ChatCompletionTool } from '@mlc-ai/web-llm';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type ToolCallResult } from '../../transformers/toolCallParser';
import { initWebLlmEngine } from './engineLifecycle';

/**
 * Generate tool calls using Hermes-3's native tool calling API.
 */
export const generateWebLlmToolCalls = inject({ logger })(
    ({ logger }) => {
        /**
         * Fallback parser for model generating raw function call text
         * like `addTrack(name="wow", kind="midi")` instead of JSON tool calls.
         */
        const tryParseRawFunctionCalls = (text: string, tools: ChatCompletionTool[]): ToolCallResult[] => {
            const results: ToolCallResult[] = [];
            const validNames = new Set(tools.map((t) => t.function.name));

            const callPattern = /(\w+)\(([^)]*)\)/g;
            let match;

            while ((match = callPattern.exec(text)) !== null) {
                const name = match[1]!;
                const argsStr = match[2] ?? '';

                if (!validNames.has(name)) {continue;}

                const args: Record<string, unknown> = {};
                const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|([.\w]+))/g;
                let argMatch;
                while ((argMatch = argPattern.exec(argsStr)) !== null) {
                    const key = argMatch[1]!;
                    const val = argMatch[2] ?? argMatch[3]!;
                    if (val === 'true') {args[key] = true;}
                    else if (val === 'false') {args[key] = false;}
                    else if (!isNaN(Number(val)) && val !== '') {args[key] = Number(val);}
                    else {args[key] = val;}
                }

                results.push({ name, arguments: args });
            }

            if (results.length > 0) {
                logger.info(
                    `[WebLLM] Parsed ${String(results.length)} raw function call(s): ${results.map((r) => r.name).join(', ')}`
                );
            }
            return results;
        };

        return async function generateWebLlmToolCalls(
            systemPrompt: string,
            userMessage: string,
            tools: ChatCompletionTool[]
        ): Promise<ToolCallResult[]> {
            const eng = await initWebLlmEngine();

            const messages: ChatCompletionMessageParam[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ];

            try {
                // Yield to render loop before first inference — WebGPU shader compilation
                // locks the GPU and can freeze the compositor.
                await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

                const response = (await eng.chat.completions.create({
                    messages,
                    tools,
                    tool_choice: 'auto',
                    stream: false,
                    temperature: 0.1,
                    seed: 0,
                })) as {
                    choices: Array<{
                        message: {
                            content: string | null;
                            tool_calls?: Array<{ function: { name: string; arguments: string } }>;
                        };
                    }>;
                };

                const toolCallsRaw = response.choices[0]?.message?.tool_calls;

                if (!toolCallsRaw || toolCallsRaw.length === 0) {
                    const textContent = response.choices[0]?.message?.content;
                    if (textContent) {
                        logger.warn(`[WebLLM] No tool calls, got text: ${textContent.slice(0, 200)}`);
                        return tryParseRawFunctionCalls(textContent, tools);
                    }
                    logger.warn('[WebLLM] No tool calls returned by model.');
                    return [];
                }

                const results: ToolCallResult[] = [];
                for (const tc of toolCallsRaw) {
                    if (tc.function?.name) {
                        let args: Record<string, unknown> = {};
                        try {
                            args = JSON.parse(tc.function.arguments ?? '{}') as Record<string, unknown>;
                        } catch {
                            logger.warn(
                                `[WebLLM] Failed to parse tool call args for "${tc.function.name}": ${tc.function.arguments}`
                            );
                        }
                        results.push({ name: tc.function.name, arguments: args });
                    }
                }

                logger.info(`[WebLLM] ${String(results.length)} tool call(s): ${results.map((r) => r.name).join(', ')}`);
                return results;
            } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                logger.warn(`[WebLLM] Tool call API failed: ${errMsg.slice(0, 300)}`);

                const rawMatch = errMsg.match(/Got outputMessage:\s*(.+?)(?:\s*Got error:|$)/s);
                if (rawMatch?.[1]) {
                    return tryParseRawFunctionCalls(rawMatch[1].trim(), tools);
                }

                return [];
            }
        };
    }
);
