import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type IntentResult } from '../models/IntentResult';
import { type ProjectContext } from '../models/ProjectContext';
import { validateActions } from './validateActions';
import { parseToolCallsToActions } from './validateLlmOutput';
import { isLlmAvailable, generateToolCalls } from './llmOrchestration';
import { buildSystemPrompt } from '../helpers/actionSchema';
import {
    tryPresetMatch,
    buildPresetContext,
    tryParameterizedPath,
    tryCompoundFastPath,
    requiresConfirmation,
} from '../transformers/promptParser';

// Re-export for consumers
export { isComplexPrompt } from '../transformers/promptParser';

const logger = Container.getInstance().get(Logger);

/**
 * Two-tier prompt parsing:
 * 1. Fast-path: fuzzy-match against preset action registry
 * 2. Parameterized fast-path: regex for commands that need values (tempo N, transpose N)
 * 3. LLM path: Hermes 3 function calling for complex, compound, or ambiguous natural language
 */
export async function parsePromptToActions(
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
            confidence: 0.95,
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
            confidence: 0.95,
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
            confidence: 0.95,
            rawText: prompt,
            requiresConfirmation: requiresConfirmation(validated),
        };
    }

    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    // 4. LLM path: Hermes 3 function calling for complex/ambiguous instructions
    if (isLlmAvailable()) {
        try {
            const result = await parseLlmPath(prompt, context, signal);
            if (result.actions.length === 0) {
                logger.warn(`[AI] LLM path returned 0 actions for prompt: "${prompt}"`);
            }
            return result;
        } catch (error) {
            if (signal?.aborted) {
                return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
            }
            logger.warn(`LLM inference failed, no actions generated: ${String(error)}`);
        }
    }

    return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
}

// ── LLM path (Hermes function calling) ──────────────────────────────────

async function parseLlmPath(prompt: string, context: ProjectContext, signal?: AbortSignal): Promise<IntentResult> {
    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    const systemPrompt = buildSystemPrompt(context);
    const toolCalls = await generateToolCalls(systemPrompt, prompt);

    if (signal?.aborted) {
        return { actions: [], confidence: 0, rawText: prompt, requiresConfirmation: false };
    }

    const actions = parseToolCallsToActions(toolCalls);
    const validated = validateActions(actions);

    return {
        actions: validated,
        confidence: validated.length > 0 ? 0.9 : 0,
        rawText: prompt,
        requiresConfirmation: requiresConfirmation(validated),
    };
}
