import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { isAppError } from '#/infra/errors/isAppError';
import { getLlmEngine } from '../repositories/webLlm/engineLifecycle';
import { streamNativeCompletion } from '../repositories/nativeEngine/streaming';
import { isNativeEngineReady } from '../repositories/nativeEngine/lifecycle';
import { isCloudAvailable } from '../repositories/cloudLlm/keyManagement';
import { streamCloudChatCompletion } from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { chatStore, appendChatMessage, updateChatMessage, setChatGenerating } from '../stores/chatStore';
import { getProjectContext } from './getProjectContext';
import { type ChatMessage } from '../models/Chat';
import { type RuntimeAction } from '../models/RuntimeAction';
import { parsePromptToActions } from './parsePromptToActions';
import { describeAction, executeAppAction, generateGroupId } from '#/modules/Command/useCases';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { notifyAiChange } from './notifyAiChange';
import { setActiveAborter } from '../stores/chatStore';
/** Strip or extract a `<think>…</think>` block from LLM output, including incomplete streaming blocks. */
function extractThinkBlock(raw: string): { reasoning: string | undefined; content: string } {
    // 1. Fully formed block
    const match = raw.match(/^\s*<think>([\s\S]*?)<\/think>\s*/);
    if (match) {
        return {
            reasoning: match[1]?.trim() || undefined,
            content: raw.slice(match[0].length).trim(),
        };
    }

    // 2. Partial (streaming) block without closing tag
    const partialMatch = raw.match(/^\s*<think>([\s\S]*)$/);
    if (partialMatch) {
        return {
            reasoning: partialMatch[1]?.trim() || undefined,
            content: '', // Still thinking! No actual final content yet
        };
    }

    // 3. No think block at all
    return { reasoning: undefined, content: raw };
}

const CHAT_SYSTEM_PROMPT = `You are an AI assistant built into Sourdaw, a professional Digital Audio Workstation. You help users with music production, mixing, sound design, and navigating this DAW.

## About Sourdaw

Sourdaw is a browser-based and desktop (Tauri) DAW with these key areas:

### UI Layout
- **Top bar**: Transport controls (play/stop/record), tempo, time signature, metronome toggle
- **Left sidebar**: Has tabs for Instruments, Color (effects), Stage (effects), Library (samples), and Macros
  - Library tab has sub-tabs: "Folders" (connect local sample folders), "Imported" (imported samples), "Find" (online sample sources)
- **Center**: Arrangement timeline with tracks stacked vertically. Each track has a header (name, mute/solo/arm buttons, volume, pan) and a clip lane
- **Bottom panels**: Mixer, Piano Roll (for MIDI editing), Automation view, Analysis, Routing
- **Right panels**: Inspector (device chain for selected track), Chat (this panel), AI Generation panel
- **Prompt bar**: At the bottom — type natural language commands to create tracks, add effects, set tempo, generate patterns, etc.

### Key Features
- **Tracks**: Audio, MIDI, Bus, Master. Each has a device chain (effects/instruments)
- **Clips**: Audio clips (waveform) and MIDI clips (notes). Drag to timeline, split, move, duplicate
- **Devices**: Built-in instruments (Fermenter synth, Toaster drum machine, Levain sampler) and effects (Gluten compressor, Bacteria multi-FX, Grinder amp sim, Proof mastering suite, Yeast MIDI FX)
- **Mixer**: Channel strips with volume, pan, sends. Access via bottom panel
- **Piano Roll**: Double-click a MIDI clip to edit notes. Quantize, transpose, humanize available
- **Automation**: Click the automation icon on a track header to add automation lanes for any parameter
- **Sample Library**: Connect folders from your computer via the Library > Folders tab. Browse, search, preview, drag to timeline

### How to do things
- **Add a track**: Click "+" in track header area, or use prompt bar: "add midi track called Bass"
- **Add an effect**: Open Inspector (right panel), click "+" in device chain, or use prompt bar: "add reverb to vocals"
- **Record**: Arm a track (click arm button), then press record in transport
- **Change tempo**: Click the BPM display in transport bar, or prompt: "set tempo to 120"
- **Add samples**: Go to Library tab > Folders > Connect Folder, then drag samples to timeline
- **Edit MIDI**: Double-click a MIDI clip to open Piano Roll
- **Mix**: Open Mixer panel (bottom), adjust volume/pan per channel
- **Export**: File menu > Export, or Cmd/Ctrl+Shift+E
- **Undo/Redo**: Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z

### Prompt bar commands
The prompt bar at the bottom accepts natural language. Examples:
- "add drums, bass, and guitar tracks"
- "set tempo to 140"
- "mute the vocals"
- "add compressor to drum bus"
- "generate a 4-bar jazz chord progression in Bb on the keys track"
- "generate a rock drum pattern on the drums track"

## Your behavior

- Keep answers concise and in Markdown
- When explaining how to do something, tell them WHERE to click and WHAT to select
- If the user asks you to perform an action, tell them to use the prompt bar at the bottom and give them the exact command to type
- When referring to tracks, clips, or devices, use their names from the project context
- If asked something unrelated to music production or this DAW, respond helpfully but start with: "You know there are better tools for this type of question, right?" then answer briefly anyway`;

export async function sendChatMessage(userText: string): Promise<void> {
const backend = resolveBackend();

// Verify the appropriate engine is available
if (backend === 'none') {
throw createAiRuntimeError('No AI backend available. Configure an API key or use a WebGPU-capable browser.');
}
if (backend === 'native' && !isNativeEngineReady()) {
throw createAiRuntimeError('Native AI engine is not running. Load the AI engine first.');
}
if (backend === 'webllm' && !getLlmEngine()) {
throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
}
if (backend === 'cloud' && !isCloudAvailable()) {
throw createAiRuntimeError('Cloud AI not configured. Set API key in settings.');
}

const state = chatStore.value;
if (!state || state.isGenerating) {
return;
}

setChatGenerating(true);

// ── Prompt Command Mode ──────────────────────────────────────────────
if (state.chatMode === 'prompt') {
const aborter = new AbortController();
setActiveAborter(aborter);

try {
    const context = getProjectContext();
    const result = await parsePromptToActions(userText, context, aborter.signal);

    if (result.actions.length > 0) {
        // Manually inject messages for Fast-Path execution
        const userMsgId = `msg-${crypto.randomUUID()}`;
        appendChatMessage({
            id: userMsgId,
            role: 'user',
            content: userText,
            timestamp: Date.now(),
            isDsoAction: true,
        });

        const assistantMsgId = `msg-${crypto.randomUUID()}`;
        appendChatMessage({
            id: assistantMsgId,
            role: 'assistant',
            content: 'Executing...',
            timestamp: Date.now(),
            isDsoAction: true,
        });
        const group = generateGroupId(userText);
        const executedLabels: Array<{ action: RuntimeAction; label: string }> = [];

        for (const action of result.actions) {
            await executeAppAction(action, { ...group, source: 'prompt' });
            executedLabels.push({ action, label: describeAction(action) });
        }

        const historyGroup: AiActionGroup = {
            id: group.groupId,
            prompt: userText,
            actions: executedLabels.map((l) => ({ kind: 'appAction', actionType: l.action.type, label: l.label })),
            groupId: group.groupId,
            timestamp: Date.now(),
            reverted: false,
        };
        pushAiActionGroup(historyGroup);

        notifyAiChange(
            `Executed: ${userText}`,
            result.actions.map((a) => a.type)
        );

        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            content: `Executed:\n\n${executedLabels.map((l) => `- **${l.action.type.replace(/_/g, ' ')}**: ${l.label}`).join('\n')}`,
        });
    } else if (result._jsonEditApplied) {
        // executeDsoEdit already injected the user message and the assistant streaming message.
        // We just need to trigger the toast notification.
        const summary = result._jsonEditSummaries?.join('. ') ?? `Executed: ${userText}`;
        notifyAiChange(summary, []);
    } else if (!result._jsonEditAttempted) {
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'user',
            content: userText,
            timestamp: Date.now(),
            isDsoAction: true,
        });
        appendChatMessage({
            id: `msg-${crypto.randomUUID()}`,
            role: 'assistant',
            content: 'No actions were matched or executed for your command.',
            timestamp: Date.now(),
            error: 'No actions matched',
        });
    }
} catch (error) {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: 'Failed to process prompt command.',
        error: String(error),
        timestamp: Date.now(),
    });
} finally {
    setActiveAborter(null);
    setChatGenerating(false);
}
return;
}

// ── Regular Chat Mode ───────────────────────────────────────────────
const userMsgId = `msg-${crypto.randomUUID()}`;
appendChatMessage({
id: userMsgId,
role: 'user',
content: userText,
timestamp: Date.now(),
});

const assistantMsgId = `msg-${crypto.randomUUID()}`;
const initialAssistantMessage: ChatMessage = {
id: assistantMsgId,
role: 'assistant',
content: '',
timestamp: Date.now(),
isStreaming: true,
};
appendChatMessage(initialAssistantMessage);

const aborter = new AbortController();
setActiveAborter(aborter);
let fullContent = '';

try {
const workspaceContext = getProjectContext();

const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\nCURRENT DAW CONTEXT:\n${JSON.stringify(workspaceContext)}`;

// Keep only the last 24 messages (12 user+assistant pairs) to avoid
// blowing the context window on long conversations.
const conversationHistory = chatStore
    .value!.messages.filter((m) => m.id !== assistantMsgId && !m.error)
    .slice(-24)
    .map((m) => ({
        role: m.role,
        content: m.content,
    }));

const completionMessages = [{ role: 'system' as const, content: systemPrompt }, ...conversationHistory].filter(
    (m) => m.role === 'system' || m.role === 'user' || m.role === 'assistant'
) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

if (backend === 'native') {
    // Native: streaming completion via Tauri Channel API
    await streamNativeCompletion(
        completionMessages,
        (token) => {
            if (aborter.signal.aborted) throw createAiRuntimeError('AbortedByUser');
            fullContent += token;
            const parsed = extractThinkBlock(fullContent);
            updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
        },
        { temperature: 0.7, maxTokens: 2048 }
    );
} else if (backend === 'cloud') {
    // Cloud: streaming completion via Claude API
    await streamCloudChatCompletion(
        completionMessages,
        (token) => {
            if (aborter.signal.aborted) throw createAiRuntimeError('AbortedByUser');
            fullContent += token;
            const parsed = extractThinkBlock(fullContent);
            updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
        },
        { temperature: 0.7, maxTokens: 2048 }
    );
} else {
    // WebLLM: streaming completion via the in-browser engine.
    // Yield to the render loop before starting inference — the first
    // forward pass triggers WebGPU shader compilation which locks the
    // GPU (shared with the compositor). Without this yield, the browser
    // can't paint the "Thinking..." state before the GPU gets busy.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

    const engine = getLlmEngine()!;
    const asyncChunkGenerator = (await engine.chat.completions.create({
        messages: completionMessages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
        extra_body: { enable_thinking: state.enableReasoning },
    })) as AsyncIterable<any>;

    for await (const chunk of asyncChunkGenerator) {
        if (aborter.signal.aborted) {
            break;
        }
        const deltaDesc = chunk.choices[0]?.delta.content;
        if (deltaDesc !== undefined) {
            fullContent += deltaDesc;
            const parsed = extractThinkBlock(fullContent);
            updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
        }
    }
}

// Strip <think>…</think> reasoning block before storing the final message.
const { reasoning, content: cleanContent } = extractThinkBlock(fullContent);
updateChatMessage(assistantMsgId, { isStreaming: false, content: cleanContent, reasoning });
} catch (error) {
const errorMessage = isAppError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : 'An unknown error occurred during generation.';
if (errorMessage === 'AbortedByUser' || errorMessage.includes('AbortError')) {
    // Clean abort, leave generated partial content intact and strip parsing blocks
    const parsed = extractThinkBlock(fullContent);
    updateChatMessage(assistantMsgId, {
        isStreaming: false,
        content: parsed.content,
        reasoning: parsed.reasoning,
    });
} else {
    updateChatMessage(assistantMsgId, {
        isStreaming: false,
        error: errorMessage,
        content: 'Sorry, I encountered an error while thinking about that.',
    });
}
} finally {
setActiveAborter(null);
setChatGenerating(false);
}
}
