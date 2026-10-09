import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { chatStore, clearChatMessages } from '../../../stores/chatStore';
import { openAnswerInChat } from '../openAnswerInChat';

const mocks = vi.hoisted(() => ({
    toggleChatPanel: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));

const answer = {
    prompt: 'How loud is the master?',
    text: '**Loudness:** the master integrates at -14.2 LUFS.',
    evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Measured the master.' }],
};

function setChatPanelOpen(chatPanelOpen: boolean): void {
    const current = workspaceStore.value;
    if (current === null) {
        throw new Error('The workspace store has no state.');
    }
    workspaceStore.set({ ...current, chatPanelOpen });
}

describe('openAnswerInChat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearChatMessages();
    });

    it('shows the request and the whole answer, with its evidence, as an ordinary chat reply', () => {
        setChatPanelOpen(true);

        openAnswerInChat(answer);

        const messages = chatStore.value?.messages ?? [];
        expect(
            messages.map(({ role, content, answerEvidence, error }) => ({ role, content, answerEvidence, error }))
        ).toEqual([
            { role: 'user', content: answer.prompt, answerEvidence: undefined, error: undefined },
            { role: 'assistant', content: answer.text, answerEvidence: answer.evidence, error: undefined },
        ]);
        expect(mocks.toggleChatPanel).not.toHaveBeenCalled();
    });

    it('opens the chat panel when it is closed', () => {
        setChatPanelOpen(false);

        openAnswerInChat(answer);

        expect(mocks.toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});
