import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { type ChatMessage, type ChatState } from '../models/Chat';

const logger = Container.getInstance().get(Logger);

const initialChatState: ChatState = {
    messages: [],
    isGenerating: false,
};

export const chatStore = new Store<ChatState>(logger, {
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
        messages: currentState.messages.map((m) => (m.id === id ? { ...m, ...partialUpdate } : m)),
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

/**
 * Clears the chat history.
 */
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
