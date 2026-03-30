/**
 * JSON Editor orchestrator — the main entry point for the new AI editing flow.
 *
 * Flow:
 * 1. Serialize current project state as EASE-encoded JSON
 * 2. Send to LLM with user's request
 * 3. Parse LLM response as edited JSON
 * 4. Diff original vs edited to extract changes
 * 5. Validate changes
 * 6. Apply (or preview for destructive ops)
 *
 * This replaces the tool-calling approach with a simpler, more powerful
 * "edit the document" paradigm — like a code agent editing code.
 */
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { serializeProjectState, type EditableProjectState, getCurrentRevision } from './serializeProjectState';
import { diffProjectState, summarizeChanges, validateChanges, hasDestructiveChanges, type ProjectChange } from './diffAndPatch';
import { applyProjectChanges } from './applyChanges';
import { buildJsonEditorPrompt } from './jsonEditorPrompt';
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

export type JsonEditResult = {
    success: boolean;
    changes: ProjectChange[];
    summaries: string[];
    error?: string;
};

/**
 * Execute a JSON edit request from the user.
 *
 * @param userRequest Natural language edit request
 * @param options.preview If true, return changes without applying
 * @param options.scopeTrackIds Limit context to specific tracks
 * @param options.includeNotes Include MIDI note data for selected clips
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
        return {
            success: false,
            changes: [],
            summaries: [],
            error: 'No AI backend available',
        };
    }

    // 1. Serialize current state
    const originalState = serializeProjectState({
        includeNotes: options?.includeNotes,
        scopeTrackIds: options?.scopeTrackIds,
    });
    const baseRevision = getCurrentRevision();
    const projectJson = JSON.stringify(originalState, null, 2);

    // 2. Build prompt
    const { system, user } = buildJsonEditorPrompt(projectJson, userRequest);

    // 3. Show user message in chat
    const userMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: userMsgId,
        role: 'user',
        content: userRequest,
        timestamp: Date.now(),
    });

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: assistantMsgId,
        role: 'assistant',
        content: 'Editing project...',
        timestamp: Date.now(),
        isStreaming: true,
    });

    setChatGenerating(true);
    llmStatusStore.set({ state: 'generating' });

    try {
        // 4. Get LLM response
        const responseJson = await getEditResponse(backend, system, user);

        // 5. Parse response as JSON
        let editedState: EditableProjectState;
        try {
            editedState = JSON.parse(responseJson);
        } catch {
            // Try to extract JSON from response (in case model wrapped it)
            const jsonMatch = responseJson.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                editedState = JSON.parse(jsonMatch[0]);
            } else {
                throw new Error('LLM response is not valid JSON');
            }
        }

        // 6. Concurrency check
        if (getCurrentRevision() !== baseRevision) {
            logger.warn('[JSON Editor] State changed during generation — rebasing');
            // For now, proceed anyway. A full implementation would re-diff against current state.
        }

        // 7. Diff
        const changes = diffProjectState(originalState, editedState);
        const summaries = summarizeChanges(changes);

        if (changes.length === 0) {
            updateChatMessage(assistantMsgId, {
                content: 'No changes needed — the project already matches your request.',
                isStreaming: false,
            });
            setChatGenerating(false);
            llmStatusStore.set({ state: 'ready', modelId: 'json-editor' });
            return { success: true, changes: [], summaries: [] };
        }

        // 8. Validate changes before applying
        const validationErrors = validateChanges(changes, originalState);
        if (validationErrors.length > 0) {
            const errorSummary = validationErrors.map((e) => e.reason).join('; ');
            updateChatMessage(assistantMsgId, {
                content: `Edit rejected — validation failed: ${errorSummary}`,
                isStreaming: false,
                error: `Validation: ${errorSummary}`,
            });
            setChatGenerating(false);
            llmStatusStore.set({ state: 'ready', modelId: 'json-editor' });
            return { success: false, changes: [], summaries: [], error: errorSummary };
        }

        // 9. Force preview for destructive changes unless explicitly opted out
        const forcePreview = hasDestructiveChanges(changes) && options?.preview !== false;
        const shouldPreview = options?.preview || forcePreview;

        if (!shouldPreview) {
            // Snapshot stores before applying so undo can restore them
            const trackSnapshot = structuredClone(trackStore.value);
            const transportSnapshot = structuredClone(transportStore.value);

            const applied = applyProjectChanges(changes);

            // Capture post-apply state for redo
            const trackAfter = structuredClone(trackStore.value);
            const transportAfter = structuredClone(transportStore.value);

            // Create proper undo entry in the command system
            const { groupId, groupLabel } = generateGroupId(userRequest);
            const undoEntry = createCallbackUndoEntry(
                `AI: ${summaries[0] ?? userRequest}`,
                () => {
                    // Undo: restore pre-edit snapshots
                    if (trackSnapshot) { trackStore.set(trackSnapshot); }
                    if (transportSnapshot) { transportStore.set(transportSnapshot); }
                },
                () => {
                    // Redo: restore post-edit snapshots
                    if (trackAfter) { trackStore.set(trackAfter); }
                    if (transportAfter) { transportStore.set(transportAfter); }
                },
                'ai',
            );
            undoEntry.groupId = groupId;
            undoEntry.groupLabel = groupLabel;
            pushUndo(undoEntry);

            // Also record in AI action history panel
            pushAiActionGroup({
                id: `ai-edit-${Date.now()}`,
                prompt: userRequest,
                actions: applied.map((desc) => ({ kind: 'jsonEdit' as const, label: desc })),
                groupId,
                timestamp: Date.now(),
                reverted: false,
            });

            updateChatMessage(assistantMsgId, {
                content: `Done! ${summaries.join('. ')}.`,
                isStreaming: false,
            });
        } else {
            const destructiveWarning = hasDestructiveChanges(changes)
                ? '\n\n⚠ This includes destructive changes (deletions). '
                : '';
            updateChatMessage(assistantMsgId, {
                content: `Preview: ${summaries.join('. ')}.${destructiveWarning}\n\nType "apply" to confirm or "cancel" to discard.`,
                isStreaming: false,
            });
        }

        setChatGenerating(false);
        llmStatusStore.set({ state: 'ready', modelId: 'json-editor' });
        return { success: true, changes, summaries };
    } catch (error) {
        const errorMessage = error instanceof Error ? error : new Error(String(error));
        const message = errorMessage.message;
        logger.error(errorMessage);

        updateChatMessage(assistantMsgId, {
            content: `Sorry, I couldn't complete that edit: ${message}`,
            isStreaming: false,
            error: message,
        });

        setChatGenerating(false);
        llmStatusStore.set({ state: 'error', message });
        return { success: false, changes: [], summaries: [], error: message };
    }
}

/**
 * Get the edit response from whichever backend is active.
 */
async function getEditResponse(backend: string, system: string, user: string): Promise<string> {
    const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
    ];

    if (backend === 'cloud' && isCloudAvailable()) {
        let result = '';
        await streamCloudChatCompletion(messages, (chunk) => {
            result += chunk;
        });
        return result;
    }

    if (backend === 'native' && isNativeEngineReady()) {
        let result = '';
        await streamNativeCompletion(messages, (chunk) => {
            result += chunk;
        });
        return result;
    }

    if (backend === 'webllm') {
        const engine = getLlmEngine();
        if (!engine) {
            throw new Error('WebLLM engine not initialized');
        }
        const response = await engine.chat.completions.create({
            messages,
            temperature: 0.1,
            max_tokens: 4096,
        });
        return response.choices[0]?.message?.content ?? '';
    }

    throw new Error(`Unknown backend: ${backend}`);
}
