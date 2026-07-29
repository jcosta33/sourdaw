import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { type IntentResult } from '../models/IntentResult';
import { type RuntimeAction } from '../models/RuntimeAction';
import {
    bridgeLlmToolCalls,
    buildLlmActionSystemPrompt,
    buildLlmActionUserMessage,
    LLM_EXECUTABLE_TOOL_SCHEMAS,
} from '../transformers/llmActionBridge';
import { findDeniedPromptIntent } from '../transformers/promptParser/findDeniedPromptIntent';
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

type CreateFastPathResultInput = {
    actions: RuntimeAction[];
    prompt: string;
};

function createFastPathResult(input: CreateFastPathResultInput): IntentResult {
    const validated = validateActions(input.actions);
    if (validated.length !== input.actions.length) {
        const rejectedTypes = input.actions
            .filter((action) => !validated.includes(action))
            .map((action) => action.type)
            .join(', ');
        return {
            actions: [],
            rawText: input.prompt,
            requiresConfirmation: false,
            rejectionReason: `Recognized command failed runtime validation: ${rejectedTypes}`,
        };
    }

    return {
        actions: validated,
        rawText: input.prompt,
        requiresConfirmation: requiresConfirmation(validated),
    };
}

/**
 * Prompt parsing order:
 * 1. Non-executable recognition for explicitly denied action intents
 * 2. Fast-path: fuzzy-match against executable preset action registry
 * 3. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 4. Compound fast-path: multi-track creation etc.
 * 5. Provider-neutral LLM tool path: tool calls cross a strict app-owned action bridge
 * 6. DSO fallback: only after successful provider planning returns no tool calls
 */
export const parsePromptToActions = inject({ logger })(
    ({ logger }) =>
        async function parsePromptToActions(
            prompt: string,
            context: ProjectContext,
            signal?: AbortSignal
        ): Promise<IntentResult> {
            const normalized = prompt.toLowerCase().trim();

            const deniedActionType = findDeniedPromptIntent(normalized);
            if (deniedActionType !== null) {
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    rejectionReason: `Action ${deniedActionType} cannot be executed by AI because it does not report completion.`,
                };
            }

            // 2. Try executable preset actions via fuzzy match
            const presetCtx = buildPresetContext(context);
            const presetResult = tryPresetMatch(normalized, presetCtx);
            if (presetResult.length > 0) {
                return createFastPathResult({ actions: presetResult, prompt });
            }

            // 3. Try parameterized patterns (need value extraction)
            const paramResult = tryParameterizedPath(normalized, context);
            if (paramResult.length > 0) {
                return createFastPathResult({ actions: paramResult, prompt });
            }

            // 4. Try compound fast path (multi-track creation etc.)
            const compoundResult = tryCompoundFastPath(normalized, context);
            if (compoundResult !== null) {
                return createFastPathResult({ actions: compoundResult, prompt });
            }

            if (signal?.aborted) {
                return { actions: [], rawText: prompt, requiresConfirmation: false };
            }

            // 5. Provider-neutral LLM path. This only proposes typed actions;
            // sendChatMessage remains responsible for confirmation and execution.
            try {
                const planningOutcome = await generateToolCalls(
                    buildLlmActionSystemPrompt(),
                    buildLlmActionUserMessage({ prompt, context }),
                    LLM_EXECUTABLE_TOOL_SCHEMAS,
                    signal
                );

                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }

                if (planningOutcome.status === 'rejected') {
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: `Provider planning rejected: ${planningOutcome.reason}`,
                    };
                }
                const toolCalls = planningOutcome.toolCalls;
                const bridged = bridgeLlmToolCalls({ calls: toolCalls, context: getProjectContext() });
                for (const rejected of bridged.rejections) {
                    logger.warn(
                        `[AI] Rejected tool call ${String(rejected.index)} (${rejected.name}): ${rejected.reason}`
                    );
                }

                if (bridged.rejections.length > 0) {
                    const reason = bridged.rejections
                        .map((rejection) => `${rejection.name}: ${rejection.reason}`)
                        .join('; ');
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: `Provider action rejected: ${reason}`,
                    };
                }

                if (bridged.actions.length > 0) {
                    const validated = validateActions(bridged.actions);
                    if (validated.length !== bridged.actions.length) {
                        const rejectedTypes = bridged.actions
                            .filter((action) => !validated.includes(action))
                            .map((action) => action.type)
                            .join(', ');
                        logger.warn('[AI] Rejected LLM action batch because runtime validation removed an action');
                        return {
                            actions: [],
                            rawText: prompt,
                            requiresConfirmation: false,
                            rejectionReason: `Provider action failed runtime validation: ${rejectedTypes}`,
                        };
                    }

                    return {
                        actions: validated,
                        rawText: prompt,
                        requiresConfirmation: validated.length > 1 || requiresConfirmation(validated),
                        executionMode: 'atomic',
                    };
                }

                if (toolCalls.length > 0) {
                    const reason = 'Provider planning returned tool calls that did not produce executable actions.';
                    logger.warn(`[AI] ${reason}`);
                    return {
                        actions: [],
                        rawText: prompt,
                        requiresConfirmation: false,
                        rejectionReason: reason,
                    };
                }
            } catch (error) {
                if (isAiRuntimeConfigurationChangedError(error)) {
                    throw error;
                }
                if (signal?.aborted) {
                    return { actions: [], rawText: prompt, requiresConfirmation: false };
                }
                const reason = error instanceof Error ? error.message : String(error);
                logger.warn(`[AI] Provider tool planning failed: ${reason}`);
                return {
                    actions: [],
                    rawText: prompt,
                    requiresConfirmation: false,
                    rejectionReason: `Provider planning failed: ${reason}`,
                };
            }

            // 6. DSO fallback — every non-empty or failed provider plan returned above.
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
