import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type IntentResult } from '../models/IntentResult';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
    requiresConfirmation,
} from '../transformers/promptParser/parsing';

import { executeDsoEdit } from './dsoEditor/executeDsoEdit';
import { type ProjectContext } from './getProjectContext';
import { isDsoBackendAvailable } from './llmOrchestration/backendResolution/isDsoBackendAvailable';
import { validateActions } from './validateActions';

/**
 * Two-tier prompt parsing:
 * 1. Fast-path: fuzzy-match against preset action registry (instant, no LLM)
 * 2. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 3. Compound fast-path: multi-track creation etc.
 * 4. LLM path: DSO editor — Qwen emits typed Domain-Specific Operations via schema-constrained generation
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

            // 4. LLM path: DSO editor — Qwen3-8B emits typed Domain-Specific Operations
            // Cloud is NOT used for DSO planning (chat only). No model fallback.
            if (isDsoBackendAvailable()) {
                try {
                    const result = await executeDsoEdit(prompt, signal);

                    if (signal?.aborted) {
                        return { actions: [], rawText: prompt, requiresConfirmation: false };
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
