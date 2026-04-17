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
import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';
import { type Dso, type EditPlan, EDIT_PLAN_JSON_SCHEMA, classifyEditPlan } from '../../models/DsoTypes';
import { serializeLogicalState, buildProjectSummary, logEdit } from './serializeLogicalState';
import { buildDsoPrompt } from './dsoPrompt';
import { resolveDsoNames, validateDsos, executeDsos } from './compileDso';

type ExecuteDsosFn = (dsos: Dso[]) => Promise<string[]>;
import { resolveBackend } from '../llmOrchestration/backendResolution/helpers';
import { isDsoBackendAvailable } from '../llmOrchestration/backendResolution/isDsoBackendAvailable';
import { isNativeEngineReady } from '../../repositories/nativeEngine/lifecycle';
import { streamNativeCompletion } from '../../repositories/nativeEngine/streaming';
import { getActiveModelId, getLlmEngine } from '../../repositories/webLlm/engineLifecycle';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { appendChatMessage, updateChatMessage, setChatGenerating } from '../../stores/chatStore';
import { pushAiActionGroup } from '../../stores/aiActionHistoryStore';
import { commitUndoEntry, createUndoEntry, generateGroupId } from '#/modules/Command/useCases';
import { saveSnapshot } from '#/modules/CrdtDocument/useCases';

export type DsoEditResult = {
    success: boolean;
    plan: EditPlan | null;
    summaries: string[];
    error?: string;
};

/**
 * Execute a DSO edit request — the single orchestration entrypoint.
 */
export const executeDsoEdit = inject({ logger })(({ logger }) =>
    (async function executeDsoEdit(userRequest: string): Promise<DsoEditResult> {
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
        const rawResponse = await invokeLlm(backend, system, user, assistantMsgId);

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
            const errorText = resolutionErrors.map((e) => e.reason).join('; ');
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
            const errorText = validationErrors.map((e) => e.reason).join('; ');
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
            const summaries = await commitDsos(plan, userRequest, assistantMsgId, reasoning, executeDsos);
            const descriptions = plan.dsos.filter((d) => d.op.startsWith('remove')).map((d) => d.op.replace(/_/g, ' '));
            updateChatMessage(assistantMsgId, {
                content: `Done (destructive): ${summaries.join('. ')}.\n\nRemoved: ${descriptions.join(', ')}. Use Ctrl+Z to undo.`,
                isStreaming: false,
                reasoning,
                isDsoAction: true,
            });
            finish();
            return { success: true, plan, summaries };
        }

        // 10. Execute with undo support
        const summaries = await commitDsos(plan, userRequest, assistantMsgId, reasoning, executeDsos);

        finish();
        return { success: true, plan, summaries };
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
})
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function finish(): void {
    setChatGenerating(false);
    llmStatusStore.set({ state: 'ready', modelId: 'qwen3-8b' });
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

function parseEditPlan(responseText: string): EditPlan {
    // Strip any residual <think>…</think> that wasn't caught by extractReasoning
    const clean = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 1. Try direct parse on the clean response
    try {
        const parsed = JSON.parse(clean) as Record<string, unknown>;
        if (parsed.kind === 'edit_plan' && Array.isArray(parsed.dsos)) {
            return parsed as EditPlan;
        }
    } catch {
        // fall through to regex salvage
    }

    // 2. Extract the outermost JSON object that contains "kind":"edit_plan"
    //    Use a greedy match so we get the full JSON including all nested arrays.
    const match = clean.match(/\{[\s\S]*"kind"\s*:\s*"edit_plan"[\s\S]*\}/);
    if (match) {
        try {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            if (parsed.kind === 'edit_plan' && Array.isArray(parsed.dsos)) {
                return parsed as EditPlan;
            }
        } catch (e) {
            const preview = clean.slice(0, 120).replace(/\n/g, ' ');
            throw createAiRuntimeError(
                `LLM returned malformed JSON (${e instanceof Error ? e.message : String(e)}). ` +
                    `Response preview: "${preview}…" — ` +
                    `The model may have run out of tokens mid-response. Try a simpler request or increase max_tokens.`
            );
        }
    }

    const preview = clean.slice(0, 120).replace(/\n/g, ' ');
    throw createAiRuntimeError(`LLM response is not a valid EditPlan. Preview: "${preview}…"`);
}

async function commitDsos(
    plan: EditPlan,
    userRequest: string,
    assistantMsgId: string,
    reasoning: string | undefined,
    runDsos: ExecuteDsosFn
): Promise<string[]> {
    // Binary snapshot of ALL Automerge documents before the edit.
    // Much more compact than structuredClone(store.value) and correctly captures
    // every store — including midiStore — that the DSO may modify.
    const bundleBefore = saveSnapshot();

    // Execute
    const summaries = await runDsos(plan.dsos);

    // Binary snapshot after — used for redo.
    const bundleAfter = saveSnapshot();

    // Undo entry — typed ActionUndoEntry (serializable data, no anonymous closures)
    const { groupId, groupLabel } = generateGroupId(userRequest);
    const undoEntry = createUndoEntry(
        `AI: ${plan.intent}`,
        { type: 'restoreDsoSnapshot', payload: { bundle: bundleAfter } },
        { type: 'restoreDsoSnapshot', payload: { bundle: bundleBefore } },
        'ai'
    );
    undoEntry.groupId = groupId;
    undoEntry.groupLabel = groupLabel;
    commitUndoEntry(undoEntry);

    // Action history
    pushAiActionGroup({
        id: `dso-edit-${Date.now()}`,
        prompt: userRequest,
        actions: summaries.map((s) => ({ kind: 'jsonEdit' as const, label: s })),
        groupId,
        timestamp: Date.now(),
        reverted: false,
    });

    // Log for future prompt context
    for (const s of summaries) {
        logEdit(s);
    }

    // Update chat
    updateChatMessage(assistantMsgId, {
        content: `Done! ${summaries.join('. ')}.`,
        isStreaming: false,
        reasoning,
        isDsoAction: true,
    });

    return summaries;
}

// ── LLM invocation per backend ───────────────────────────────────────────────

async function invokeLlm(backend: string, system: string, user: string, chatMsgId: string): Promise<string> {
    let tokenCount = 0;

    const onProgress = (): void => {
        tokenCount++;
        if (tokenCount % 15 === 0) {
            updateChatMessage(chatMsgId, { content: `Planning... (${tokenCount} tokens)` });
        }
    };

    // Native (Tauri + mistral.rs): use schema-constrained generation
    if (backend === 'native' && isNativeEngineReady() && isTauri()) {
        return invokeNativeSchemaConstrained(system, user, onProgress);
    }

    // Native fallback (dev mode llama-server): use regular streaming
    if (backend === 'native' && isNativeEngineReady()) {
        let result = '';
        const messages = [
            { role: 'system' as const, content: system },
            { role: 'user' as const, content: user },
        ];
        await streamNativeCompletion(messages, (chunk) => {
            result += chunk;
            onProgress();
        });
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
                const fallbackMsg =
                    fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
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

/**
 * Invoke mistral.rs with Constraint::JsonSchema for schema-guaranteed output.
 * Uses the schema_constrained_generation Tauri command with a Tauri Channel.
 */
async function invokeNativeSchemaConstrained(system: string, user: string, onProgress: () => void): Promise<string> {
    const { createChannel } = await import('#/utils/tauriBridge');

    type StreamEvent =
        | { event: 'token'; data: { text: string } }
        | { event: 'done'; data: { totalTokens: number } }
        | { event: 'error'; data: { message: string } };

    let result = '';
    let streamError: string | null = null;

    const channel = await createChannel<StreamEvent>();
    channel.onmessage = (event: StreamEvent) => {
        if (event.event === 'token') {
            result += event.data.text;
            onProgress();
        }
        if (event.event === 'error') {
            streamError = event.data.message;
        }
    };

    await tauriInvoke('schema_constrained_generation', {
        systemPrompt: system,
        userMessage: user,
        jsonSchema: EDIT_PLAN_JSON_SCHEMA,
        temperature: 0.1,
        maxTokens: 2048,
        onEvent: channel,
    });

    if (streamError) {
        throw createAiRuntimeError(streamError);
    }

    return result;
}
