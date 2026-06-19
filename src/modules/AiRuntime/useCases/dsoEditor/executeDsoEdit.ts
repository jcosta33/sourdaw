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
import { commitActionUndoEntry, generateGroupId } from '#/modules/Command/stores';
import { transactSnapshot } from '#/modules/CrdtDocument/useCases';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { createAiRuntimeError } from '../../errors/AiRuntimeError';
import { type Dso, type EditPlan, EDIT_PLAN_JSON_SCHEMA, classifyEditPlan } from '../../models/DsoTypes';
import { isNativeEngineReady } from '../../repositories/nativeEngine/lifecycle';
import { streamNativeCompletion } from '../../repositories/nativeEngine/streaming';
import { getActiveModelId, getLlmEngine } from '../../repositories/webLlm/engineLifecycle';
import { pushAiActionGroup } from '../../stores/aiActionHistoryStore';
import { appendChatMessage, updateChatMessage, setChatGenerating } from '../../stores/chatStore';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { resolveBackend } from '../llmOrchestration/backendResolution/helpers';
import { isDsoBackendAvailable } from '../llmOrchestration/backendResolution/isDsoBackendAvailable';

import { resolveDsoNames, validateDsos, executeDsos, type DsoExecutionResult } from './compileDso';
import { buildDsoPrompt } from './dsoPrompt';
import { serializeLogicalState, buildProjectSummary, logEdit } from './serializeLogicalState';

type ExecuteDsosFn = (dsos: Dso[]) => Promise<DsoExecutionResult>;

export type DsoEditResult = {
    success: boolean;
    plan: EditPlan | null;
    summaries: string[];
    error?: string;
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
                    const { summaries, failures } = await commitDsos(
                        plan,
                        userRequest,
                        assistantMsgId,
                        reasoning,
                        executeDsos
                    );
                    const descriptions = plan.dsos
                        .filter((data) => data.op.startsWith('remove'))
                        .map((data) => data.op.replaceAll('_', ' '));
                    const failureText = formatFailures(failures);
                    updateChatMessage(assistantMsgId, {
                        content:
                            `Done (destructive): ${summaries.join('. ')}.\n\n` +
                            `Removed: ${descriptions.join(', ')}. Use Ctrl+Z to undo.${failureText}`,
                        isStreaming: false,
                        reasoning,
                        isDsoAction: failures.length === 0 ? true : undefined,
                        error: failures.length > 0 ? failureText.trim() : undefined,
                    });
                    finish();
                    return {
                        success: failures.length === 0,
                        plan,
                        summaries,
                        error: failures.length > 0 ? failureText.trim() : undefined,
                    };
                }

                // 10. Execute with undo support
                const { summaries, failures } = await commitDsos(
                    plan,
                    userRequest,
                    assistantMsgId,
                    reasoning,
                    executeDsos
                );

                finish();
                return {
                    success: failures.length === 0,
                    plan,
                    summaries,
                    error: failures.length > 0 ? formatFailures(failures).trim() : undefined,
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

/**
 * Build a human-readable suffix describing DSOs that threw during execution.
 * Returns an empty string when there were no failures.
 */
function formatFailures(failures: DsoExecutionResult['failures']): string {
    if (failures.length === 0) {
        return '';
    }
    return (
        ` However, ${failures.length} operation${failures.length === 1 ? '' : 's'} failed: ` +
        `${failures.map((failure) => `${failure.op} (${failure.reason})`).join('; ')}.`
    );
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

/**
 * Hard upper bound on the response we will scan for an embedded JSON object.
 * The LLM emits at most ~2k tokens; 16 kB of characters comfortably covers a
 * full EditPlan while bounding the cost of the salvage scan so that malformed
 * (e.g. prompt-injected) output cannot turn parsing into a DoS.
 */
const MAX_SALVAGE_LENGTH = 16 * 1024;

/** The set of valid DSO `op` values, derived from the schema (single source of truth). */
const VALID_DSO_OPS: ReadonlySet<string> = (() => {
    try {
        const schema = JSON.parse(EDIT_PLAN_JSON_SCHEMA) as {
            properties?: { dsos?: { items?: { properties?: { op?: { enum?: unknown } } } } };
        };
        const ops = schema.properties?.dsos?.items?.properties?.op?.enum;
        return new Set(Array.isArray(ops) ? ops.filter((op): op is string => typeof op === 'string') : []);
    } catch {
        return new Set<string>();
    }
})();

const VALID_MODERATIONS: ReadonlySet<string> = new Set(['allow', 'needs_confirmation', 'block']);

/**
 * Scan `text` for the first complete, brace-balanced JSON object, honoring
 * string literals and escapes so braces inside strings do not unbalance the
 * scan. Returns the object substring or `null` if none completes within the
 * scanned window. Linear-time — no backtracking.
 */
function extractBalancedJsonObject(text: string): string | null {
    const scanLimit = Math.min(text.length, MAX_SALVAGE_LENGTH);
    const start = text.indexOf('{');
    if (start === -1 || start >= scanLimit) {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < scanLimit; index++) {
        const ch = text[index]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }
    return null;
}

/**
 * Validate a parsed object against the EditPlan shape: the envelope fields
 * (`kind`, `moderation`, `intent`, `dsos`) and every DSO entry's `op`. Returns
 * an error string describing the first violation, or `null` when valid. This
 * guards against an LLM emitting JSON that parses but is not a usable plan.
 */
function validateEditPlanShape(parsed: Record<string, unknown>): string | null {
    if (parsed.kind !== 'edit_plan') {
        return 'missing or invalid "kind" (expected "edit_plan")';
    }
    if (typeof parsed.moderation !== 'string' || !VALID_MODERATIONS.has(parsed.moderation)) {
        return 'missing or invalid "moderation" (expected allow | needs_confirmation | block)';
    }
    if (typeof parsed.intent !== 'string') {
        return 'missing or invalid "intent" (expected a string)';
    }
    if (!Array.isArray(parsed.dsos)) {
        return 'missing or invalid "dsos" (expected an array)';
    }
    for (let index = 0; index < parsed.dsos.length; index++) {
        const dso = parsed.dsos[index] as unknown;
        if (typeof dso !== 'object' || dso === null) {
            return `dsos[${index}] is not an object`;
        }
        const op = (dso as Record<string, unknown>).op;
        if (typeof op !== 'string' || !VALID_DSO_OPS.has(op)) {
            return `dsos[${index}] has missing or unknown "op"${typeof op === 'string' ? ` ("${op}")` : ''}`;
        }
    }
    return null;
}

export function parseEditPlan(responseText: string): EditPlan {
    // Strip any residual <think>…</think> that wasn't caught by extractReasoning
    const clean = responseText.replaceAll(/<think>[\s\S]*?<\/think>/g, '').trim();

    // 1. Try direct parse on the clean response
    try {
        const parsed = JSON.parse(clean) as Record<string, unknown>;
        if (validateEditPlanShape(parsed) === null) {
            return parsed as EditPlan;
        }
    } catch {
        // fall through to brace-balanced salvage
    }

    // 2. Salvage: extract the first complete, brace-balanced JSON object.
    //    A linear-time, escape-aware scan with a hard size cap — no greedy
    //    regex, so malformed/adversarial output cannot trigger catastrophic
    //    backtracking inside the generation loop.
    const candidate = extractBalancedJsonObject(clean);
    const preview = clean.slice(0, 120).replaceAll('\n', ' ');
    if (candidate) {
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(candidate) as Record<string, unknown>;
        } catch (error) {
            throw createAiRuntimeError(
                `LLM returned malformed JSON (${error instanceof Error ? error.message : String(error)}). ` +
                    `Response preview: "${preview}…" — ` +
                    `The model may have run out of tokens mid-response. Try a simpler request or increase max_tokens.`
            );
        }
        const shapeError = validateEditPlanShape(parsed);
        if (shapeError === null) {
            return parsed as EditPlan;
        }
        throw createAiRuntimeError(`LLM response is not a valid EditPlan (${shapeError}). Preview: "${preview}…"`);
    }

    throw createAiRuntimeError(`LLM response is not a valid EditPlan. Preview: "${preview}…"`);
}

async function commitDsos(
    plan: EditPlan,
    userRequest: string,
    assistantMsgId: string,
    reasoning: string | undefined,
    runDsos: ExecuteDsosFn
): Promise<DsoExecutionResult> {
    // Execute and capture binary snapshots of ONLY the Automerge documents
    // that were dirtied during the execution.
    let summaries: string[] = [];
    let failures: DsoExecutionResult['failures'] = [];
    const { before: bundleBefore, after: bundleAfter } = await transactSnapshot(async () => {
        const result = await runDsos(plan.dsos);
        summaries = result.summaries;
        failures = result.failures;
    });

    // Undo entry — typed ActionUndoEntry (serializable data, no anonymous closures)
    const { groupId, groupLabel } = generateGroupId(userRequest);
    commitActionUndoEntry({
        label: `AI: ${plan.intent}`,
        action: { type: 'restoreDsoSnapshot', payload: { bundle: bundleAfter } },
        inverseAction: { type: 'restoreDsoSnapshot', payload: { bundle: bundleBefore } },
        source: 'ai',
        groupId,
        groupLabel,
    });

    // Action history
    pushAiActionGroup({
        id: `dso-edit-${Date.now()}`,
        prompt: userRequest,
        actions: summaries.map((state) => ({ kind: 'jsonEdit' as const, label: state })),
        groupId,
        timestamp: Date.now(),
        reverted: false,
    });

    // Log for future prompt context
    for (const state of summaries) {
        logEdit(state);
    }

    // Update chat — surface any per-DSO failures instead of an unconditional
    // "Done!". A DSO that threw during execution is reported, not dropped.
    const failureText = formatFailures(failures);
    const appliedText = summaries.length > 0 ? `Done! ${summaries.join('. ')}.` : 'No changes were applied.';
    updateChatMessage(assistantMsgId, {
        content: `${appliedText}${failureText}`,
        isStreaming: false,
        reasoning,
        isDsoAction: failures.length === 0 ? true : undefined,
        error: failures.length > 0 ? failureText.trim() : undefined,
    });

    return { summaries, failures };
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
