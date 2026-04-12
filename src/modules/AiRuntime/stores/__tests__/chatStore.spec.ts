import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    clearChatMessages,
    toggleReasoning,
    setChatMode,
    stopGenerating,
    setActiveAborter,
} from '../chatStore';

describe('chatStore', () => {
    beforeEach(() => {
        chatStore.set({
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'chat',
        });
        setActiveAborter(null);
    });

    describe('appendChatMessage', () => {
        it('appends a new message to the list', () => {
            const msg = { id: 'm1', role: 'user' as const, content: 'Hello' };
            appendChatMessage(msg);
            expect(chatStore.value!.messages).toHaveLength(1);
            expect(chatStore.value!.messages[0]).toEqual(msg);
        });
    });

    describe('updateChatMessage', () => {
        it('updates an existing message', () => {
            const msg = { id: 'm1', role: 'assistant' as const, content: 'Hi', isStreaming: true };
            appendChatMessage(msg);

            updateChatMessage('m1', { content: 'Hi there', isStreaming: false });

            const updated = chatStore.value!.messages[0]!;
            expect(updated.content).toBe('Hi there');
            expect(updated.isStreaming).toBe(false);
        });

        it('does nothing if the message is not found', () => {
            const msg = { id: 'm1', role: 'user' as const, content: 'Hi' };
            appendChatMessage(msg);

            updateChatMessage('missing', { content: 'test' });

            expect(chatStore.value!.messages[0]!.content).toBe('Hi');
        });
    });

    describe('setChatGenerating', () => {
        it('updates the isGenerating flag', () => {
            setChatGenerating(true);
            expect(chatStore.value!.isGenerating).toBe(true);

            setChatGenerating(false);
            expect(chatStore.value!.isGenerating).toBe(false);
        });
    });

    describe('clearChatMessages', () => {
        it('clears messages and resets isGenerating', () => {
            appendChatMessage({ id: 'm1', role: 'user', content: 'test' });
            setChatGenerating(true);

            clearChatMessages();

            expect(chatStore.value!.messages).toEqual([]);
            expect(chatStore.value!.isGenerating).toBe(false);
        });
    });

    describe('toggleReasoning', () => {
        it('toggles the reasoning state flag', () => {
            expect(chatStore.value!.enableReasoning).toBe(true);
            
            toggleReasoning();
            expect(chatStore.value!.enableReasoning).toBe(false);
            
            toggleReasoning();
            expect(chatStore.value!.enableReasoning).toBe(true);
        });
    });

    describe('setChatMode', () => {
        it('sets the chat mode to chat or prompt', () => {
            setChatMode('prompt');
            expect(chatStore.value!.chatMode).toBe('prompt');

            setChatMode('chat');
            expect(chatStore.value!.chatMode).toBe('chat');
        });
    });

    describe('stopGenerating / setActiveAborter', () => {
        it('aborts the active controller if one is set', () => {
            const mockAbort = vi.fn();
            const aborter = { abort: mockAbort } as unknown as AbortController;
            
            setActiveAborter(aborter);
            stopGenerating();

            expect(mockAbort).toHaveBeenCalled();
        });

        it('does not throw if no controller is set', () => {
            setActiveAborter(null);
            expect(() => stopGenerating()).not.toThrow();
        });
    });
});
