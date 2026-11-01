import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtProject,
    DOC_PREFIX_ROOT,
    mutateCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { chatStore, clearChatMessages } from '../../../stores/chatStore';
import { pendingActionConfirmationStore } from '../../../stores/pendingActionConfirmationStore';
import { type AiAnswerNotice } from '../../aiChangeNotificationState';
import { openAnswerInChat } from '../openAnswerInChat';

const mocks = vi.hoisted(() => ({
    toggleChatPanel: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleChatPanel: mocks.toggleChatPanel,
}));

function answerAboutLiveProject(): AiAnswerNotice {
    return {
        prompt: 'How loud is the master?',
        text: '**Loudness:** the master integrates at -14.2 LUFS.',
        evidence: [{ callId: 'call-1', toolName: 'analysis.measure', summary: 'Measured the master.' }],
        projectIdentity: captureProjectIdentity(),
        projectRevision: captureProjectRevision(),
    };
}

function setChatPanelOpen(chatPanelOpen: boolean): void {
    const current = workspaceStore.value;
    if (current === null) {
        throw new Error('The workspace store has no state.');
    }
    workspaceStore.set({ ...current, chatPanelOpen });
}

function chatMessages() {
    return (chatStore.value?.messages ?? []).map(({ role, content, answerEvidence, error }) => ({
        role,
        content,
        answerEvidence,
        error,
    }));
}

describe('openAnswerInChat', () => {
    let database: ReturnType<typeof installTransactionalIndexedDb>;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        database = installTransactionalIndexedDb();
        await createCrdtProject('Project A');
        clearChatMessages();
    });

    afterEach(async () => {
        await database.dispose();
        vi.unstubAllGlobals();
    });

    it('shows the request and the whole answer, with its evidence, while its project and revision are live', () => {
        setChatPanelOpen(true);
        const answer = answerAboutLiveProject();
        const confirmationsBefore = pendingActionConfirmationStore.value;
        const undoBefore = undoHistoryStore.value;
        const revisionBefore = captureProjectRevision();

        expect(openAnswerInChat(answer)).toBe('opened');

        expect(chatMessages()).toEqual([
            { role: 'user', content: answer.prompt, answerEvidence: undefined, error: undefined },
            { role: 'assistant', content: answer.text, answerEvidence: answer.evidence, error: undefined },
        ]);
        expect(mocks.toggleChatPanel).not.toHaveBeenCalled();
        expect(pendingActionConfirmationStore.value).toEqual(confirmationsBefore);
        expect(undoHistoryStore.value).toEqual(undoBefore);
        expect(captureProjectRevision()).toBe(revisionBefore);
    });

    it('opens the chat panel when it is closed', () => {
        setChatPanelOpen(false);

        expect(openAnswerInChat(answerAboutLiveProject())).toBe('opened');

        expect(mocks.toggleChatPanel).toHaveBeenCalledTimes(1);
    });

    it('still opens an answer when only the command-batch checkpoint was journaled since', () => {
        setChatPanelOpen(true);
        const answer = answerAboutLiveProject();
        mutateCrdtDoc<Record<string, unknown>>({
            id: DOC_PREFIX_ROOT,
            changeFn: (doc) => {
                doc.commandBatchIdempotency = { records: [{ batchId: 'batch-1' }] };
            },
        });
        expect(captureProjectRevision()).not.toBe(answer.projectRevision);

        expect(openAnswerInChat(answer)).toBe('opened');

        expect(chatMessages().map(({ content }) => content)).toEqual([answer.prompt, answer.text]);
    });

    it('appends nothing and opens no panel once another project is open', async () => {
        setChatPanelOpen(false);
        const answer = answerAboutLiveProject();
        await createCrdtProject('Project B');
        expect(captureProjectIdentity()).not.toBe(answer.projectIdentity);
        clearChatMessages();

        expect(openAnswerInChat(answer)).toBe('project-switched');

        expect(chatMessages()).toEqual([]);
        expect(mocks.toggleChatPanel).not.toHaveBeenCalled();
    });

    it('appends nothing and opens no panel once the same project has changed', () => {
        setChatPanelOpen(false);
        const answer = answerAboutLiveProject();
        mutateCrdtDoc<Record<string, unknown>>({
            id: DOC_PREFIX_ROOT,
            changeFn: (doc) => {
                doc.tempo = 128;
            },
        });
        expect(captureProjectIdentity()).toBe(answer.projectIdentity);

        expect(openAnswerInChat(answer)).toBe('project-changed');

        expect(chatMessages()).toEqual([]);
        expect(mocks.toggleChatPanel).not.toHaveBeenCalled();
    });
});
