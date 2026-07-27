import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { type IntentResult } from '../models/IntentResult';
import {
    bridgeLlmToolCalls,
    buildLlmActionSystemPrompt,
    buildLlmActionUserMessage,
    LLM_EXECUTABLE_TOOL_SCHEMAS,
} from '../transformers/llmActionBridge';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
    requiresConfirmation,
} from '../transformers/promptParser/parsing';

import { executeDsoEdit } from './dsoEditor/executeDsoEdit';
import { getProjectContext, type ProjectContext } from './getProjectContext';
import { isDsoBackendAvailable } from './llmOrchestration/backendResolution/isDsoBackendAvailable';
import { generateToolCalls } from './llmOrchestration/inference';
import { validateActions } from './validateActions';

/**
 * Two-tier prompt parsing:
 * 1. Fast-path: fuzzy-match against preset action registry (instant, no LLM)
 * 2. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 3. Compound fast-path: multi-track creation etc.
 * 4. Provider-neutral LLM tool path: tool calls cross a strict app-owned action bridge
 * 5. DSO fallback: Qwen emits typed Domain-Specific Operations via schema-constrained generation
 */
export const parsePromptToActions = inject({ logger })(
    ({ logger }) =>
        async function parsePromptToActions(
            prompt: string,
            context: ProjectContext,
            signal?: AbortSignal
        ): Promise<IntentResult> {
            const normalized = prompt.toLowerCase().trim();

            // 1. Try preset actions via fuzzy match
            const presetCtx = buildPresetContext(context);
            const presetResult = tryPresetMatch(normalized, presetCtx);
            if (presetResult.length > 0) {
                const validated = validateActions(presetResult);
                return {
                    actions: validated,
                    rawText: prompt,
                    requiresConfirmation: requiresConfirmation(validated),
                };
            }

            // 2. Try parameterized patterns (need value extraction)
            const paramResult = tryParameterizedPath(normalized, context);
            if (paramResult.length > 0) {
                const validated = validateActions(paramResult);
                return {
                    actions: validated,
                    rawText: prompt,
                    requiresConfirmation: requiresConfirmation(validated),
                };
            }

            // 3. Try compound fast path (multi-track creation etc.)
            const compoundResult = tryCompoundFastPath(normalized, context);
            if (compoundResult !== null) {
                const validated = validateActions(compoundResult);
                return {
                    actions: validated,
                    rawText: prompt,
                    requiresConfirmation: requiresConfirmation(validated),
                };
            }

            if (signal?.aborted) {
                return { actions: [], rawText: prompt, requiresConfirmation: false };
            }

            // 4. Provider-neutral LLM path. This only proposes typed actions;
            // sendChatMessage remains responsible for confirmation and execution.
            try {
                const toolCalls = await generateToolCalls(
                    buildLlmActionSystemPrompt(),
                    buildLlmActionUserMessage({ prompt, context }),
                    LLM_EXECUTABLE_TOOL_SCHEMAS,
                    signal
                );

                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }

                const bridged = bridgeLlmToolCalls({ calls: toolCalls, context: getProjectContext() });
                for (const rejected of bridged.rejections) {
                    logger.warn(
                        `[AI] Rejected tool call ${String(rejected.index)} (${rejected.name}): ${rejected.reason}`
                    );
                }

                if (bridged.actions.length > 0 && bridged.rejections.length === 0) {
                    const validated = validateActions(bridged.actions);
                    if (validated.length === bridged.actions.length) {
                        return {
                            actions: validated,
                            rawText: prompt,
                            requiresConfirmation: validated.length > 1 || requiresConfirmation(validated),
                            executionMode: 'atomic',
                        };
                    }
                    logger.warn('[AI] Rejected LLM action batch because runtime validation removed an action');
                }
            } catch (error) {
                if (isAiRuntimeConfigurationChangedError(error)) {
                    throw error;
                }
                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }
                logger.warn(`[AI] Provider tool planning failed: ${String(error)}`);
            }

            // 5. DSO fallback — Qwen3-8B emits typed Domain-Specific Operations.
            if (isDsoBackendAvailable()) {
                try {
                    const result = await executeDsoEdit(prompt, signal);

                    if (signal?.aborted) {
                        return { actions: [], rawText: prompt, requiresConfirmation: false };
                    }

                    if (result.success && result.pendingConfirmationId) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            _jsonEditAttempted: true,
                        };
                    }

                    if (result.success) {
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            _jsonEditApplied: true,
                            _jsonEditSummaries: result.summaries,
                        };
                    } else {
                        logger.warn(`[AI] DSO editor failed: ${result.error ?? 'unknown'}`);
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            _jsonEditAttempted: true,
                        };
                    }
                } catch (error) {
                    if (signal?.aborted) {
                        return { actions: [], rawText: prompt, requiresConfirmation: false };
                    }
                    logger.warn(`[AI] DSO editor failed: ${String(error)}`);
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        _jsonEditAttempted: true,
                    };
                }
            }

            return { actions: [], rawText: prompt, requiresConfirmation: false };
        }
);
