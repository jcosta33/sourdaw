/**
 * JSON Editor orchestrator — the main entry point for the new AI editing flow.
 *
 * Flow:
 * 1. Serialize current project state as EASE-encoded JSON
 * 2. Build prompt with project summary + few-shot examples
 * 3. Stream LLM response with progressive UI updates
 * 4. Parse response as edited JSON
 * 5. Semantic rebase if state changed during generation
 * 6. Diff original vs edited to extract changes
 * 7. Validate changes (timeline, params, references)
 * 8. Apply with full undo support (or preview for destructive ops)
 */
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { serializeProjectState, type EditableProjectState, getCurrentRevision } from './serializeProjectState';
import {
    diffProjectState,
    summarizeChanges,
    validateChanges,
    hasDestructiveChanges,
    type ProjectChange,
} from './diffAndPatch';
import { applyProjectChanges } from './applyChanges';
import { buildJsonEditorPrompt, type ProjectSummary } from './jsonEditorPrompt';
import { resolveBackend, isLlmAvailable } from '../llmOrchestration';
import { streamCloudChatCompletion, isCloudAvailable } from '../../repositories/cloudLlm';
import { streamNativeCompletion, isNativeEngineReady } from '../../repositories/nativeEngine';
import { getLlmEngine } from '../../repositories/webLlm';
import { llmStatusStore } from '../../stores/llmStatusStore';
import { appendChatMessage, updateChatMessage, setChatGenerating } from '../../stores/chatStore';
import { pushAiActionGroup } from '../../stores/aiActionHistoryStore';
import { pushUndo } from '#/modules/Command/stores/undoStore';
import { createCallbackUndoEntry, generateGroupId } from '#/modules/Command/models/UndoEntry';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

const logger = Container.getInstance().get(Logger);

/** Track recent AI edit summaries for project summary context. */
const recentEditLog: string[] = [];
const MAX_RECENT_EDITS = 5;

function logRecentEdit(summary: string): void {
    recentEditLog.push(summary);
    if (recentEditLog.length > MAX_RECENT_EDITS) {
        recentEditLog.shift();
    }
}

export type JsonEditResult = {
    success: boolean;
    changes: ProjectChange[];
    summaries: string[];
    error?: string;
};

/**
 * Execute a JSON edit request from the user.
 */
export async function executeJsonEdit(
    userRequest: string,
    options?: {
        preview?: boolean;
        scopeTrackIds?: string[];
        includeNotes?: boolean;
    }
): Promise<JsonEditResult> {
    const backend = resolveBackend();

    if (backend === 'none' || !isLlmAvailable()) {
        return { success: false, changes: [], summaries: [], error: 'No AI backend available' };
    }

    // 1. Serialize current state
    const originalState = serializeProjectState({
        includeNotes: options?.includeNotes,
        scopeTrackIds: options?.scopeTrackIds,
    });
    const baseRevision = getCurrentRevision();
    const projectJson = JSON.stringify(originalState, null, 2);

    // 2. Build prompt with project summary
    const summary = buildProjectSummary(originalState);
    const { system, user } = buildJsonEditorPrompt(projectJson, userRequest, summary);

    // 3. Show user message in chat
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
        content: 'Thinking...',
        timestamp: Date.now(),
        isStreaming: true,
    });

    setChatGenerating(true);
    llmStatusStore.set({ state: 'generating' });

    try {
        // 4. Get LLM response with streaming UI updates
        const responseJson = await getEditResponse(backend, system, user, assistantMsgId);

        // 5. Parse response as JSON
        const editedState = parseEditedState(responseJson);

        // 6. Semantic rebase: if state changed during generation, re-diff against CURRENT state
        let diffBase = originalState;
        if (getCurrentRevision() !== baseRevision) {
            logger.warn('[JSON Editor] State changed during generation — rebasing against current state');
            diffBase = serializeProjectState({
                includeNotes: options?.includeNotes,
                scopeTrackIds: options?.scopeTrackIds,
            });
        }

        // 7. Diff
        const changes = diffProjectState(diffBase, editedState);
        const summaries = summarizeChanges(changes);

        if (changes.length === 0) {
            updateChatMessage(assistantMsgId, {
                content: 'No changes needed — the project already matches your request.',
                isStreaming: false,
            });
            finish();
            return { success: true, changes: [], summaries: [] };
        }

        // 8. Validate
        const validationErrors = validateChanges(changes, diffBase);
        if (validationErrors.length > 0) {
            const errorSummary = validationErrors.map((e) => e.reason).join('; ');
            updateChatMessage(assistantMsgId, {
                content: `Edit rejected — validation failed: ${errorSummary}`,
                isStreaming: false,
                error: `Validation: ${errorSummary}`,
            });
            finish();
            return { success: false, changes: [], summaries: [], error: errorSummary };
        }

        // 9. Apply or preview
        const forcePreview = hasDestructiveChanges(changes) && options?.preview !== false;
        const shouldPreview = options?.preview || forcePreview;

        if (!shouldPreview) {
            commitChanges(changes, summaries, userRequest, assistantMsgId);
        } else {
            const warning = hasDestructiveChanges(changes)
                ? '\n\n**Warning:** This includes destructive changes (deletions).'
                : '';
            updateChatMessage(assistantMsgId, {
                content: `Preview: ${summaries.join('. ')}.${warning}\n\nType "apply" to confirm or "cancel" to discard.`,
                isStreaming: false,
            });
        }

        finish();
        return { success: true, changes, summaries };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(err);

        updateChatMessage(assistantMsgId, {
            content: `Sorry, I couldn't complete that edit: ${err.message}`,
            isStreaming: false,
            error: err.message,
        });

        setChatGenerating(false);
        llmStatusStore.set({ state: 'error', message: err.message });
        return { success: false, changes: [], summaries: [], error: err.message };
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function finish(): void {
    setChatGenerating(false);
    llmStatusStore.set({ state: 'ready', modelId: 'json-editor' });
}

function buildProjectSummary(state: EditableProjectState): ProjectSummary {
    const trackIds = Object.keys(state.tracks);
    const selectedId = state.selection.trackId;
    const selectedTrack = selectedId ? state.tracks[selectedId] : null;

    return {
        trackCount: trackIds.length,
        tempo: state.transport.tempo,
        selectedTrackName: selectedTrack?.name ?? null,
        recentEdits: [...recentEditLog],
    };
}

function parseEditedState(responseJson: string): EditableProjectState {
    // Try direct parse first
    try {
        return JSON.parse(responseJson);
    } catch {
        // Model may have wrapped JSON in markdown fences or added commentary
    }

    // Extract JSON object from response
    const jsonMatch = responseJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }

    throw new Error('LLM response is not valid JSON');
}

function commitChanges(
    changes: ProjectChange[],
    summaries: string[],
    userRequest: string,
    assistantMsgId: string
): void {
    // Snapshot stores before applying
    const trackSnapshot = structuredClone(trackStore.value);
    const transportSnapshot = structuredClone(transportStore.value);

    const applied = applyProjectChanges(changes);

    // Snapshot after applying for redo
    const trackAfter = structuredClone(trackStore.value);
    const transportAfter = structuredClone(transportStore.value);

    // Push to undo system with proper callback entry
    const { groupId, groupLabel } = generateGroupId(userRequest);
    const undoEntry = createCallbackUndoEntry(
        `AI: ${summaries[0] ?? userRequest}`,
        () => {
            if (trackSnapshot) {
                trackStore.set(trackSnapshot);
            }
            if (transportSnapshot) {
                transportStore.set(transportSnapshot);
            }
        },
        () => {
            if (trackAfter) {
                trackStore.set(trackAfter);
            }
            if (transportAfter) {
                transportStore.set(transportAfter);
            }
        },
        'ai'
    );
    undoEntry.groupId = groupId;
    undoEntry.groupLabel = groupLabel;
    pushUndo(undoEntry);

    // Push to AI action history panel
    pushAiActionGroup({
        id: `ai-edit-${Date.now()}`,
        prompt: userRequest,
        actions: applied.map((desc) => ({ kind: 'jsonEdit' as const, label: desc })),
        groupId,
        timestamp: Date.now(),
        reverted: false,
    });

    // Track recent edits for future prompt context
    for (const s of summaries) {
        logRecentEdit(s);
    }

    updateChatMessage(assistantMsgId, {
        content: `Done! ${summaries.join('. ')}.`,
        isStreaming: false,
    });
}

/**
 * Get the edit response from whichever backend is active.
 * Streams tokens to the chat UI progressively.
 */
async function getEditResponse(backend: string, system: string, user: string, chatMsgId: string): Promise<string> {
    const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
    ];

    let tokenCount = 0;

    const onChunk = (_chunk: string, result: string): void => {
        tokenCount++;
        // Update chat with progress every 20 tokens (not every token to avoid thrashing)
        if (tokenCount % 20 === 0) {
            const lineCount = (result.match(/\n/g) ?? []).length;
            updateChatMessage(chatMsgId, {
                content: `Editing... (${lineCount} lines generated)`,
            });
        }
    };

    if (backend === 'cloud' && isCloudAvailable()) {
        let result = '';
        await streamCloudChatCompletion(messages, (chunk) => {
            result += chunk;
            onChunk(chunk, result);
        });
        return result;
    }

    if (backend === 'native' && isNativeEngineReady()) {
        let result = '';
        await streamNativeCompletion(messages, (chunk) => {
            result += chunk;
            onChunk(chunk, result);
        });
        return result;
    }

    if (backend === 'webllm') {
        const engine = getLlmEngine();
        if (!engine) {
            throw new Error('WebLLM engine not initialized');
        }
        updateChatMessage(chatMsgId, { content: 'Generating edit...' });
        const response = await engine.chat.completions.create({
            messages,
            temperature: 0.1,
            max_tokens: 4096,
        });
        return response.choices[0]?.message?.content ?? '';
    }

    throw new Error(`Unknown backend: ${backend}`);
}
