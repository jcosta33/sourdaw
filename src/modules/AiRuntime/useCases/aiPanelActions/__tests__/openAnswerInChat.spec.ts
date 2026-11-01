import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { undoHistoryStore } from '#/modules/Command/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtProject,
    DOC_PREFIX_ROOT,
    mutateCrdtDoc,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint,
    registerCrdtStorageRuntime,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore, type ProjectStoreState } from '#/modules/Project/stores';
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

    describe('across a save of the project the answer was about', () => {
        const createdAt = 1_700_000_000_000;

        beforeEach(() => {
            registerCrdtStorageRuntime();
            projectStore.set({
                ...defaultProjectStoreState,
                name: 'Project A',
                createdAt,
                updatedAt: createdAt,
            });
            flushAutomergeStorageWrites();
        });

        afterEach(() => {
            configureAutomergeStoragePort(null);
        });

        function projectMetaUpdate(update: Partial<ProjectStoreState>): void {
            const current = projectStore.value;
            if (current === null) {
                throw new Error('The project store has no state.');
            }
            projectStore.set({ ...current, ...update });
            flushAutomergeStorageWrites();
        }

        it('still opens an answer when only a save stamped its timestamp since', () => {
            setChatPanelOpen(true);
            const answer = answerAboutLiveProject();

            // The two project-store writes saveProject makes around its snapshot.
            projectMetaUpdate({ updatedAt: createdAt + 60_000, dirty: true });
            projectMetaUpdate({ dirty: false, identityPersistencePending: false });
            expect(captureProjectRevision()).not.toBe(answer.projectRevision);
            expect(projectRevisionMatchesLiveIgnoringCommandCheckpoint(answer.projectRevision)).toBe(false);

            expect(openAnswerInChat(answer)).toBe('opened');

            expect(chatMessages().map(({ content }) => content)).toEqual([answer.prompt, answer.text]);
        });

        it('refuses an answer once the project was renamed, saved or not', () => {
            setChatPanelOpen(false);
            const answer = answerAboutLiveProject();

            projectMetaUpdate({ name: 'Project A (renamed)', updatedAt: createdAt + 60_000 });

            expect(openAnswerInChat(answer)).toBe('project-changed');

            expect(chatMessages()).toEqual([]);
            expect(mocks.toggleChatPanel).not.toHaveBeenCalled();
        });

        it('refuses an answer once the tuning changed', () => {
            setChatPanelOpen(false);
            const answer = answerAboutLiveProject();
            const tuning = projectStore.value?.tuning;
            if (tuning === undefined) {
                throw new Error('The project store has no tuning.');
            }

            projectMetaUpdate({
                tuning: {
                    name: 'A = 442 Hz',
                    frequencies: tuning.frequencies.map((frequency) => frequency * (442 / 440)),
                },
            });

            expect(openAnswerInChat(answer)).toBe('project-changed');

            expect(chatMessages()).toEqual([]);
        });
    });
});
