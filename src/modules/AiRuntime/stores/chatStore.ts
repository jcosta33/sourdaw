import { createStore } from '#/infra/store/createStore';

import { type ChatMessage, type ChatState } from '../models/Chat';

let activeAborter: AbortController | null = null;

const initialChatState: ChatState = {
    messages: [],
    isGenerating: false,
    enableReasoning: true,
    chatMode: 'chat',
};

export const chatStore = createStore<ChatState>({
    initialData: initialChatState,
});

/**
 * Appends a new message to the chat history array.
 */
export function appendChatMessage(message: ChatMessage): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }

    chatStore.set({
        ...currentState,
        messages: [...currentState.messages, message],
    });
}

/**
 * Updates an existing message in the chat history, usually for streaming content.
 */
export function updateChatMessage(id: string, partialUpdate: Partial<ChatMessage>): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }

    chatStore.set({
        ...currentState,
        messages: currentState.messages.map((message) =>
            message.id === id ? { ...message, ...partialUpdate } : message
        ),
    });
}

/**
 * Sets the isGenerating global flag locking new chat submissions.
 */
export function setChatGenerating(isGenerating: boolean): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }

    chatStore.set({
        ...currentState,
        isGenerating,
    });
}

export function clearChatMessages(): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }

    chatStore.set({
        ...currentState,
        messages: [],
        isGenerating: false,
    });
}

/**
 * Toggles the reasoning block generation for the AI.
 */
export function toggleReasoning(): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }
    chatStore.set({
        ...currentState,
        enableReasoning: !currentState.enableReasoning,
    });
}

/**
 * Sets the input mode for the chat panel (chat vs prompt command).
 */
export function setChatMode(mode: 'chat' | 'prompt'): void {
    const currentState = chatStore.value;
    if (!currentState) {
        return;
    }
    chatStore.set({
        ...currentState,
        chatMode: mode,
    });
}

/**
 * Halts the currently active generation process if one exists.
 */
export function stopGenerating(): void {
    if (activeAborter) {
        activeAborter.abort();
        activeAborter = null;
    }
}

/**
 * Attaches a signal controller so the UI can halt generation.
 */
export function setActiveAborter(aborter: AbortController | null): void {
    activeAborter = aborter;
}
