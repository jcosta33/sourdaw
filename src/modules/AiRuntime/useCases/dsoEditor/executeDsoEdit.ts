/**
 * DSO Edit Orchestrator — single entrypoint for LLM-driven DAW editing.
 *
 * Lifecycle:
 * 1. Serialize logical state (EASE-encoded)
 * 2. Build prompt with project summary + few-shot examples
 * 3. Invoke LLM with schema constraint (Constraint::JsonSchema)
 * 4. Stream response with progressive UI updates
 * 5. Parse EditPlan from response
 * 6. Handle moderation / empty-plan early exits
 * 7. Resolve LLM-emitted names to store IDs
 * 8. Validate DSOs against current state
 * 9. Classify safety (auto-apply / preview / confirmation)
 * 10. Execute with full undo support
 */
import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { type EditPlan, EDIT_PLAN_JSON_SCHEMA, classifyEditPlan } from '../../models/DsoTypes';
import { isNativeEngineReady } from '../../repositories/nativeEngine/isNativeEngineReady';
import { generateSchemaConstrainedNativeCompletion } from '../../repositories/nativeEngine/schemaConstrainedGeneration';
import { streamNativeCompletion } from '../../repositories/nativeEngine/streaming';
import { getActiveModelId } from '../../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../../repositories/webLlm/getLlmEngine';
import { appendChatMessage, updateChatMessage, setChatGenerating } from '../../stores/chatStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { proposePendingDsoConfirmation } from '../../stores/pendingActionConfirmationStore';
import { resolveBackend } from '../llmOrchestration/backendResolution/helpers';
import { isDsoBackendAvailable } from '../llmOrchestration/backendResolution/isDsoBackendAvailable';

import { buildProjectSummary } from './buildProjectSummary';
import { commitDsoEditPlan } from './commitDsoEditPlan';
import { buildDsoPrompt } from './dsoPrompt';
import { getDsoConfirmationTargets } from './getDsoConfirmationTargets';
import { parseEditPlan } from './parseEditPlan';
import { resolveDsoNames } from './resolveDsoNames';
import { serializeLogicalState } from './serializeLogicalState';
import { validateDsos } from './validateDsos';

export type DsoEditResult = {
    success: boolean;
    plan: EditPlan | null;
    summaries: string[];
    error?: string;
    pendingConfirmationId?: string;
};

/**
 * Execute a DSO edit request — the single orchestration entrypoint.
 */
export const executeDsoEdit = inject({ logger })(
    ({ logger }) =>
        async function executeDsoEdit(userRequest: string, signal?: AbortSignal): Promise<DsoEditResult> {
            const backend = resolveBackend();

            if (!isDsoBackendAvailable()) {
                return {
                    success: false,
                    plan: null,
                    summaries: [],
                    error: 'No DSO-capable backend available (Qwen3-8B required)',
                };
            }

            // 1. Serialize logical state
            const logicalState = serializeLogicalState({ includeNoteCount: true });
            const summary = buildProjectSummary();

            // 2. Build prompt
            const { system, user } = buildDsoPrompt(logicalState, userRequest, summary);

            // 3. Chat UI messages
            appendChatMessage({
                id: `msg-${crypto.randomUUID()}`,
                role: 'user',
                content: userRequest,
                timestamp: Date.now(),
            });

            const assistantMsgId = `msg-${crypto.randomUUID()}`;
            appendChatMessage({
                id: assistantMsgId,
                role: 'assistant',
                content: 'Planning edit...',
                timestamp: Date.now(),
                isStreaming: true,
            });

            setChatGenerating(true);
            llmStatusStore.set({ state: 'generating' });

            try {
                // 4. Invoke LLM — schema-constrained for native, regular for others
                const rawResponse = await invokeLlm(backend, system, user, assistantMsgId, signal);

                // 5. Extract reasoning tokens (Qwen3 uses <think>...</think>) and parse EditPlan
                const { reasoning, cleanResponse } = extractReasoning(rawResponse);
                const plan = parseEditPlan(cleanResponse);

                // 6. Handle moderation
                if (plan.moderation === 'block') {
                    updateChatMessage(assistantMsgId, {
                        content: `Cannot do that: ${plan.intent}`,
                        isStreaming: false,
                        reasoning,
                        isDsoAction: true,
                    });
                    finish();
                    return { success: true, plan, summaries: [] };
                }

                if (plan.dsos.length === 0) {
                    updateChatMessage(assistantMsgId, {
                        content: plan.intent || 'No changes needed.',
                        isStreaming: false,
                        reasoning,
                        isDsoAction: true,
                    });
                    finish();
                    return { success: true, plan, summaries: [] };
                }

                // 7. Resolve names to IDs (LLM outputs human names, we look up the real IDs)
                const resolutionErrors = resolveDsoNames(plan.dsos);
                if (resolutionErrors.length > 0) {
                    const errorText = resolutionErrors.map((event) => event.reason).join('; ');
                    updateChatMessage(assistantMsgId, {
                        content: `Could not resolve references: ${errorText}`,
                        isStreaming: false,
                        error: errorText,
                        reasoning,
                        isDsoAction: true,
                    });
                    finish();
                    return { success: false, plan, summaries: [], error: errorText };
                }

                // 8. Validate DSOs (now with resolved IDs)
                const validationErrors = validateDsos(plan.dsos);
                if (validationErrors.length > 0) {
                    const errorText = validationErrors.map((event) => event.reason).join('; ');
                    updateChatMessage(assistantMsgId, {
                        content: `Edit rejected — ${errorText}`,
                        isStreaming: false,
                        error: errorText,
                    });
                    finish();
                    return { success: false, plan, summaries: [], error: errorText };
                }

                // 9. Classify and execute
                const classification = classifyEditPlan(plan);

                if (classification === 'confirmation_required') {
                    const confirmationId = `dso-confirmation-${crypto.randomUUID()}`;
                    const confirmationMetadata = getDsoConfirmationTargets({ dsos: plan.dsos });
                    const confirmation = proposePendingDsoConfirmation({
                        id: confirmationId,
                        prompt: userRequest,
                        assistantMessageId: assistantMsgId,
                        plan,
                        actionLabels: confirmationMetadata.actionLabels,
                        confirmationTargets: confirmationMetadata.confirmationTargets,
                        reasoning,
                    });
                    if (!confirmation) {
                        throw createAiRuntimeError('Could not create destructive edit confirmation request.');
                    }

                    updateChatMessage(assistantMsgId, {
                        content:
                            `This destructive edit requires confirmation before execution:\n\n` +
                            `Intent: ${plan.intent}\n\n` +
                            `${confirmationMetadata.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                        isStreaming: false,
                        reasoning,
                        isDsoAction: true,
                        pendingActionConfirmationId: confirmation.id,
                        pendingActionConfirmationStatus: 'proposed',
                    });
                    finish();
                    return {
                        success: true,
                        plan,
                        summaries: [],
                        pendingConfirmationId: confirmation.id,
                    };
                }

                // 10. Execute with undo support
                const { summaries, failures } = await commitDsoEditPlan({
                    plan,
                    userRequest,
                    assistantMessageId: assistantMsgId,
                    reasoning,
                });

                finish();
                return {
                    success: failures.length === 0,
                    plan,
                    summaries,
                    error: failures.length > 0 ? formatResultFailures(failures) : undefined,
                };
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.error(err);

                updateChatMessage(assistantMsgId, {
                    content: `Edit failed: ${err.message}`,
                    isStreaming: false,
                    error: err.message,
                });

                setChatGenerating(false);
                llmStatusStore.set({ state: 'error', message: err.message });
                return { success: false, plan: null, summaries: [], error: err.message };
            }
        }
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function finish(): void {
    setChatGenerating(false);
    llmStatusStore.set({ state: 'ready', modelId: 'qwen3-8b' });
}

type FormatResultFailuresInput = Awaited<ReturnType<typeof commitDsoEditPlan>>['failures'];

function formatResultFailures(failures: FormatResultFailuresInput): string | undefined {
    if (failures.length === 0) {
        return undefined;
    }
    return failures.map((failure) => `${failure.op} (${failure.reason})`).join('; ');
}

/**
 * Extract Qwen3 reasoning tokens (<think>...</think>) from the response.
 * Returns the reasoning separately and the clean response without think tags.
 */
function extractReasoning(raw: string): { reasoning: string | undefined; cleanResponse: string } {
    const thinkMatch = raw.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
        const reasoning = thinkMatch[1]?.trim();
        const cleanResponse = raw.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        return { reasoning: reasoning || undefined, cleanResponse };
    }
    return { reasoning: undefined, cleanResponse: raw };
}

// ── LLM invocation per backend ───────────────────────────────────────────────

async function invokeLlm(
    backend: string,
    system: string,
    user: string,
    chatMsgId: string,
    signal?: AbortSignal
): Promise<string> {
    let tokenCount = 0;

    function onProgress(): void {
        tokenCount++;
        if (tokenCount % 15 === 0) {
            updateChatMessage(chatMsgId, { content: `Planning... (${tokenCount} tokens)` });
        }
    }

    if (backend === 'native' && isNativeEngineReady()) {
        // Native Tauri: use schema-constrained generation.
        const schemaConstrainedResponse = await generateSchemaConstrainedNativeCompletion({
            systemPrompt: system,
            userMessage: user,
            jsonSchema: EDIT_PLAN_JSON_SCHEMA,
            temperature: 0.1,
            maxTokens: 2048,
            onToken: onProgress,
            signal,
        });
        if (schemaConstrainedResponse !== null) {
            return schemaConstrainedResponse;
        }

        // Native fallback (dev mode llama-server): use regular streaming.
        let result = '';
        const messages = [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
        ];
        await streamNativeCompletion(
            messages,
            (chunk) => {
                result += chunk;
                onProgress();
            },
            // Thread the abort signal so a stopped DSO edit tears the dev-mode SSE
            // stream down at the source instead of draining the whole response.
            { signal }
        );
        return result;
    }

    // Cloud is NOT used for DSO planning — Qwen3-8B only, no model fallback.

    // WebLLM (browser) — streaming with response_format schema constraint.
    // If grammar-constrained generation fails (smaller models may reject tokens),
    // retry without the constraint and rely on the system prompt alone.
    if (backend === 'webllm') {
        const engine = getLlmEngine();
        if (!engine) {
            throw createAiRuntimeError('WebLLM engine not initialized');
        }
        updateChatMessage(chatMsgId, { content: 'Generating edit plan...' });

        const messages = [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
        ];

        // First attempt: with schema constraint.
        try {
            let result = '';
            const stream = (await engine.chat.completions.create({
                messages,
                temperature: 0.1,
                max_tokens: 1024,
                stream: true,
                response_format: {
                    type: 'json_object' as const,
                    schema: EDIT_PLAN_JSON_SCHEMA,
                },
            })) as AsyncIterable<{ choices: Array<{ delta?: { content?: string } }> }>;

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content;
                if (delta) {
                    result += delta;
                    onProgress();
                }
            }

            return result;
        } catch (constraintError) {
            // Smaller WebLLM models may reject the grammar-constrained token stream.
            // The system prompt already instructs the model to emit JSON, so retry
            // once without the schema constraint before giving up. If the unconstrained
            // call also fails, surface a clear error including the original failure.
            try {
                let result = '';
                const stream = (await engine.chat.completions.create({
                    messages,
                    temperature: 0.1,
                    max_tokens: 1024,
                    stream: true,
                })) as AsyncIterable<{ choices: Array<{ delta?: { content?: string } }> }>;

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta?.content;
                    if (delta) {
                        result += delta;
                        onProgress();
                    }
                }

                return result;
            } catch (fallbackError) {
                const activeModel = getActiveModelId();
                const constraintMsg =
                    constraintError instanceof Error ? constraintError.message : String(constraintError);
                const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                throw createAiRuntimeError(
                    `This edit is too complex for the current model. ` +
                        `Try loading a larger model (Pro) from the AI menu, or simplify your request.\n\n` +
                        `(Grammar-constrained attempt failed on ${activeModel}: ${constraintMsg}. ` +
                        `Unconstrained retry also failed: ${fallbackMsg}.)`
                );
            }
        }
    }

    throw createAiRuntimeError(`No available backend for DSO generation`);
}
